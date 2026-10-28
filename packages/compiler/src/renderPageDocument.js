import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePageFile } from './parser/parsePageFile.js'
import { parseComponent } from './parser/parseComponent.js'
import { parseComponentFile } from './parser/parseComponentFile.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import { generatePage } from './codegen/generatePage.js'
import { generateTemplate } from './codegen/generateTemplate.js'
import { generateCapability } from './codegen/generateCapability.js'
import { substituteCapabilityRefs } from './ast/substituteCapabilityRefs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'reactive.js'), 'utf-8')
  .replace(/export\s+/g, '')

const CAPABILITY_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'capability.js'), 'utf-8')
  .replace(/export\s+/g, '')

const LOADING_INDICATOR_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'loadingIndicator.js'), 'utf-8')
  .replace(/export\s+/g, '')

const USE_API_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'useApi.js'), 'utf-8')
  .replace(/export\s+/g, '')

const USE_CHANNEL_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'useChannel.js'), 'utf-8')
  .replace(/export\s+/g, '')

const NOT_FOUND_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'notFound.js'), 'utf-8')
  .replace(/export\s+/g, '')

const capabilityCache = new Map() // capabilitiesDir -> { signature, code }

async function loadCapabilityDefinitions(capabilitiesDir) {
  const exists = await fs.promises
    .access(capabilitiesDir)
    .then(() => true)
    .catch(() => false)
  if (!exists) return ''

  const files = (await fs.promises.readdir(capabilitiesDir)).filter((f) =>
    f.endsWith('.tyx'),
  )
  if (files.length === 0) return ''

  const stats = await Promise.all(
    files.map((f) => fs.promises.stat(path.join(capabilitiesDir, f))),
  )
  const signature = files
    .map((f, i) => `${f}:${stats[i].mtimeMs}`)
    .sort()
    .join('|')

  const cached = capabilityCache.get(capabilitiesDir)
  if (cached && cached.signature === signature) {
    return cached.code
  }

  const definitions = (
    await Promise.all(
      files.map(async (file) => {
        const source = await fs.promises.readFile(
          path.join(capabilitiesDir, file),
          'utf-8',
        )
        try {
          const capabilityNode = new Parser(
            new Lexer(source).tokenize(),
          ).parseCapability()
          return generateCapability(capabilityNode)
        } catch (err) {
          err.message = `In app/capabilities/${file}: ${err.message}`
          throw err
        }
      }),
    )
  ).join('\n\n')

  capabilityCache.set(capabilitiesDir, { signature, code: definitions })
  return definitions
}

const headCache = new Map() // headFile -> { mtimeMs, html }

// Optional project file (app/head.html) whose contents are dropped into
// <head> on every page: extra <script>, <meta> or <link> tags. A missing
// file means no extra tags. Cached by modified time so production does not
// re-read it on every request, while dev edits show up on the next reload.
async function loadHeadTags(headFile) {
  let stat
  try {
    stat = await fs.promises.stat(headFile)
  } catch {
    return ''
  }
  if (!stat.isFile()) return ''

  const cached = headCache.get(headFile)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.html

  const html = await fs.promises.readFile(headFile, 'utf-8')
  headCache.set(headFile, { mtimeMs: stat.mtimeMs, html })
  return html
}

function compileComponentSource(source, fallbackClassName) {
  const isNativeComponent = /^\s*component\s+\w+/.test(source)

  if (isNativeComponent) {
    const { componentName, script, template } = parseComponentFile(source)
    const pageNode = substituteCapabilityRefs(
      script.trim().length > 0
        ? new Parser(new Lexer(script).tokenize()).parse()
        : { props: [], state: [], computed: [], actions: [], uses: [] },
    )

    const classSource = generatePage(pageNode, componentName)
    const templateNodes = parseTemplate(template)
    const { code, rootVar } = generateTemplate(templateNodes)

    return { classSource, code, rootVar, className: componentName }
  }

  const { script, template } = parseComponent(source)

  const pageNode = substituteCapabilityRefs(
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize()).parse()
      : { props: [], state: [], computed: [], actions: [], uses: [] },
  )

  const classSource = generatePage(pageNode, fallbackClassName)
  const templateNodes = parseTemplate(template)
  const { code, rootVar } = generateTemplate(templateNodes)

  return { classSource, code, rootVar, className: fallbackClassName }
}

function applyLineOffset(err, offset) {
  const match = /at line (\d+)/.exec(err.message)
  if (match) {
    const originalLine = Number(match[1])
    const correctedLine = originalLine + offset - 1
    err.message = err.message.replace(
      `at line ${originalLine}`,
      `at line ${correctedLine}`,
    )
    err.line = correctedLine
  }
  return err
}

function parseScriptWithLineOffset(script, offset) {
  try {
    return new Parser(new Lexer(script).tokenize()).parse()
  } catch (err) {
    throw applyLineOffset(err, offset)
  }
}

function parseTemplateWithLineOffset(template, offset) {
  try {
    return parseTemplate(template)
  } catch (err) {
    throw applyLineOffset(err, offset)
  }
}

export async function renderPageDocument(
  source,
  childComponents = {},
  {
    layout = null,
    props = {},
    apiHelpers = '',
    channelsPort = null,
    // Stylesheets to link in <head>, in order. createApp passes the ones
    // that actually exist in public/. The default keeps older callers
    // working exactly as before.
    stylesheets = ['/tailwind.css'],
    capabilitiesDir = path.join(process.cwd(), 'app', 'capabilities'),
    // Optional file of extra <head> tags (scripts, meta, links).
    headFile = path.join(process.cwd(), 'app', 'head.html'),
  } = {},
) {
  const {
    pageName,
    script,
    template,
    style,
    scriptStartLine,
    templateStartLine,
  } = parsePageFile(source)

  const pageNode = substituteCapabilityRefs(
    script.trim().length > 0
      ? parseScriptWithLineOffset(script, scriptStartLine)
      : { props: [], state: [], computed: [], actions: [], uses: [] },
  )

  const classSource = generatePage(pageNode, pageName)

  const templateNodes = parseTemplateWithLineOffset(template, templateStartLine)
  const { code, rootVar } = generateTemplate(templateNodes)

  const capabilityDefinitions = await loadCapabilityDefinitions(capabilitiesDir)
  const headTags = await loadHeadTags(headFile)

  const childNames = Object.keys(childComponents)
  const childClassSources = childNames
    .map(
      (name) => compileComponentSource(childComponents[name], name).classSource,
    )
    .join('\n\n')

  const childRegistrations = childNames
    .map((name) => {
      const compiled = compileComponentSource(childComponents[name], name)
      const { code: childCode, rootVar: childRootVar, className } = compiled
      return `  components[${JSON.stringify(name)}] = {
    mount(document, props = {}) {
      const instance = new ${className}(props);
      const node = (function (document, instance) {
${childCode}
        return ${childRootVar};
      })(document, instance);
      return { node, instance };
    },
  };`
    })
    .join('\n\n')

  let layoutClassSource = ''
  let layoutMountCode = `document.getElementById("app").appendChild(${rootVar});`

  if (layout !== null) {
    const layoutCompiled = compileComponentSource(layout, '__Layout')
    layoutClassSource = layoutCompiled.classSource
    layoutMountCode = `
    const layoutInstance = new ${layoutCompiled.className}();
    (function (document, instance, pageRoot) {
${layoutCompiled.code}
      const slot = ${layoutCompiled.rootVar}.querySelector("[data-tylix-slot]");
      if (!slot) {
        throw new Error("_layout.tyx is missing a data-tylix-slot element");
      }
      slot.appendChild(pageRoot);
      document.getElementById("app").appendChild(${layoutCompiled.rootVar});
    })(document, layoutInstance, ${rootVar});`
  }

  const channelsPortScript =
    channelsPort !== null
      ? `<script>window.__TYLIX_CHANNELS_PORT__ = ${JSON.stringify(channelsPort)};</script>`
      : ''

  // If __ready() rejects (a failed needs/prefetch call), log it and keep
  // going so the page still renders, instead of showing a blank screen.
  const inlineScript = `
${RUNTIME_SOURCE}

${CAPABILITY_SOURCE}

${capabilityDefinitions}

${LOADING_INDICATOR_SOURCE}

${USE_API_SOURCE}

${NOT_FOUND_SOURCE}

${USE_CHANNEL_SOURCE}

${apiHelpers}

${classSource}

${childClassSources}

${layoutClassSource}

document.addEventListener("DOMContentLoaded", () => {
  const instance = new ${pageName}(${JSON.stringify(props)});
  const components = {};
${childRegistrations}
  (async function (document, instance, components) {
    if (typeof instance.__ready === "function") {
      try {
        await instance.__ready();
      } catch (err) {
        console.error("ready failed:", err);
      }
    }
${code}
${layoutMountCode}
    if (typeof instance.__onMount === "function") {
      try {
        await instance.__onMount();
      } catch (err) {
        console.error("onMount failed:", err);
      }
    }
  })(document, instance, components);
});
`

  const styleTag = style.trim().length > 0 ? `<style>\n${style}\n</style>` : ''

  const styleLinks = stylesheets
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n  ')

  const scriptSegments = [
    { name: 'runtime (reactive.js)', code: RUNTIME_SOURCE },
    { name: 'runtime (capability.js)', code: CAPABILITY_SOURCE },
    { name: 'capability definitions', code: capabilityDefinitions },
    { name: 'loading indicator', code: LOADING_INDICATOR_SOURCE },
    { name: 'useApi', code: USE_API_SOURCE },
    { name: 'notFound', code: NOT_FOUND_SOURCE },
    { name: 'useChannel', code: USE_CHANNEL_SOURCE },
    { name: 'app/useApi helpers', code: apiHelpers },
    { name: 'page class', code: classSource },
    { name: 'child components', code: childClassSources },
    { name: 'layout', code: layoutClassSource },
  ]

  for (const segment of scriptSegments) {
    if (!segment.code || segment.code.trim().length === 0) continue
    try {
      new Function(segment.code)
    } catch (err) {
      const genErr = new Error(
        `Generated JavaScript failed to parse in "${segment.name}": ${err.message}`,
      )
      genErr.source = segment.code
      throw genErr
    }
  }

  try {
    new Function(inlineScript)
  } catch (err) {
    const genErr = new Error(
      `Generated JavaScript failed to parse: ${err.message}`,
    )
    genErr.source = inlineScript
    throw genErr
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${channelsPortScript}
  <script>
    (function () {
      var stored = localStorage.getItem("theme");
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (stored === "dark" || (!stored && prefersDark)) {
        document.documentElement.classList.add("dark");
      }
    })();
  </script>
  <title>${pageNode.title ?? pageName}</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  ${styleLinks}
${headTags}
${styleTag}
</head>
<body>
  <div id="app"></div>
  <script>${inlineScript}</script>
</body>
</html>`
}