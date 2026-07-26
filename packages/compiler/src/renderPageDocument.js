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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'reactive.js'), 'utf-8')
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

function compileComponentSource(source, fallbackClassName) {
  const isNativeComponent = /^\s*component\s+\w+/.test(source)

  if (isNativeComponent) {
    const { componentName, script, template } = parseComponentFile(source)
    const pageNode =
      script.trim().length > 0
        ? new Parser(new Lexer(script).tokenize()).parse()
        : { props: [], state: [], computed: [], actions: [] }

    const classSource = generatePage(pageNode, componentName)
    const templateNodes = parseTemplate(template)
    const { code, rootVar } = generateTemplate(templateNodes)

    return { classSource, code, rootVar, className: componentName }
  }

  const { script, template } = parseComponent(source)

  const pageNode =
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize()).parse()
      : { props: [], state: [], computed: [], actions: [] }

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

export function renderPageDocument(
  source,
  childComponents = {},
  { layout = null, props = {}, apiHelpers = '', channelsPort = null } = {},
) {
  const {
    pageName,
    script,
    template,
    style,
    scriptStartLine,
    templateStartLine,
  } = parsePageFile(source)

  const pageNode =
    script.trim().length > 0
      ? parseScriptWithLineOffset(script, scriptStartLine)
      : { props: [], state: [], computed: [], actions: [] }

  const classSource = generatePage(pageNode, pageName)

  const templateNodes = parseTemplateWithLineOffset(template, templateStartLine)
  const { code, rootVar } = generateTemplate(templateNodes)

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

  const inlineScript = `
${RUNTIME_SOURCE}

${LOADING_INDICATOR_SOURCE}

${USE_API_SOURCE}

${USE_CHANNEL_SOURCE}

${apiHelpers}

${classSource}

${childClassSources}

${layoutClassSource}

document.addEventListener("DOMContentLoaded", () => {
  const instance = new ${pageName}(${JSON.stringify(props)});
  const components = {};
${childRegistrations}
  (function (document, instance, components) {
${code}
${layoutMountCode}
  })(document, instance, components);
});
`

  const styleTag = style.trim().length > 0 ? `<style>\n${style}\n</style>` : ''

  const scriptSegments = [
    { name: 'runtime (reactive.js)', code: RUNTIME_SOURCE },
    { name: 'loading indicator', code: LOADING_INDICATOR_SOURCE },
    { name: 'useApi', code: USE_API_SOURCE },
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
  <title>${pageName}</title>
  <link rel="stylesheet" href="/tailwind.css">
${styleTag}
</head>
<body>
  <div id="app"></div>
  <script>${inlineScript}</script>
</body>
</html>`
}
