import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePageFile } from './parser/parsePageFile.js'
import { parseComponent } from './parser/parseComponent.js'
import { parseComponentFile } from './parser/parseComponentFile.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import { normalizeLanguageOptions } from './parser/languageOptions.js'
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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const capabilityCache = new Map() // `${dir}|not=${mode}` -> { signature, code }

async function loadCapabilityDefinitions(capabilitiesDir, language) {
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

  // The same directory compiles differently under different language
  // options, so the options are part of the cache key.
  const cacheKey = `${capabilitiesDir}|not=${language.not}`
  const cached = capabilityCache.get(cacheKey)
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
            language,
          ).parseCapability()
          return generateCapability(capabilityNode)
        } catch (err) {
          err.message = `In app/capabilities/${file}: ${err.message}`
          throw err
        }
      }),
    )
  ).join('\n\n')

  capabilityCache.set(cacheKey, { signature, code: definitions })
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

// The HTML document around every page. This is what renders when the
// project has no app/index.html. A project file replaces it entirely and
// uses the same three placeholders.
const DEFAULT_SHELL = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%tylix.title%</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  %tylix.head%
</head>
<body>
  %tylix.body%
</body>
</html>`

const REQUIRED_PLACEHOLDERS = ['%tylix.head%', '%tylix.body%']

const shellCache = new Map() // shellFile -> { mtimeMs, html }

// Optional project file (app/index.html): the full HTML document, with
// its own DOCTYPE, <head> and <body>. It must contain %tylix.head% and
// %tylix.body%; %tylix.title% is optional. Cached by modified time like
// head.html. A missing file means the built-in shell above.
async function loadShell(shellFile) {
  let stat
  try {
    stat = await fs.promises.stat(shellFile)
  } catch {
    return DEFAULT_SHELL
  }
  if (!stat.isFile()) return DEFAULT_SHELL

  const cached = shellCache.get(shellFile)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.html

  const html = await fs.promises.readFile(shellFile, 'utf-8')
  const missing = REQUIRED_PLACEHOLDERS.filter((p) => !html.includes(p))
  if (missing.length > 0) {
    throw new Error(
      `app/index.html is missing ${missing.join(' and ')}. ` +
        'Put %tylix.head% inside <head> and %tylix.body% inside <body>.',
    )
  }

  shellCache.set(shellFile, { mtimeMs: stat.mtimeMs, html })
  return html
}

const loadingCache = new Map() // loadingFile -> { mtimeMs, source }

// Optional project file (app/loading.tyx): the loading indicator, written
// like a layout (<script> and <template>). A missing file returns null and
// the built-in top bar is used instead. Cached by modified time like
// head.html and index.html.
async function loadLoadingPage(loadingFile) {
  let stat
  try {
    stat = await fs.promises.stat(loadingFile)
  } catch {
    return null
  }
  if (!stat.isFile()) return null

  const cached = loadingCache.get(loadingFile)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.source

  const source = await fs.promises.readFile(loadingFile, 'utf-8')
  loadingCache.set(loadingFile, { mtimeMs: stat.mtimeMs, source })
  return source
}

const EMPTY_PAGE = { props: [], state: [], computed: [], actions: [], uses: [] }

// Turns a registry key (a tag name such as "AdminCard" or "my-card")
// into a class name that is always a valid, unique identifier. The
// index guarantees uniqueness even if two sanitized names coincide,
// and the prefix keeps a component called Map or Error from shadowing
// the global of the same name inside the shared inline script.
function childClassName(name, index) {
  return `__C${index}_${String(name).replace(/[^A-Za-z0-9_$]/g, '_')}`
}

// `fallbackClassName` ALWAYS decides the class name -- for native
// `component Card` files too -- so two files that both declare Card
// can live in one page.
function compileComponentSource(source, fallbackClassName, language) {
  const isNativeComponent = /^\s*component\s+\w+/.test(source)

  if (isNativeComponent) {
    const { script, template } = parseComponentFile(source)
    const pageNode = substituteCapabilityRefs(
      script.trim().length > 0
        ? new Parser(new Lexer(script).tokenize(), language).parse()
        : EMPTY_PAGE,
    )

    const classSource = generatePage(pageNode, fallbackClassName)
    const templateNodes = parseTemplate(template, language)
    const { code, rootVar } = generateTemplate(templateNodes)

    return { classSource, code, rootVar, className: fallbackClassName }
  }

  const { script, template } = parseComponent(source)

  const pageNode = substituteCapabilityRefs(
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize(), language).parse()
      : EMPTY_PAGE,
  )

  const classSource = generatePage(pageNode, fallbackClassName)
  const templateNodes = parseTemplate(template, language)
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

function parseScriptWithLineOffset(script, offset, language) {
  try {
    return new Parser(new Lexer(script).tokenize(), language).parse()
  } catch (err) {
    throw applyLineOffset(err, offset)
  }
}

function parseTemplateWithLineOffset(template, offset, language) {
  try {
    return parseTemplate(template, language)
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
    // Optional full HTML document that wraps every page.
    shellFile = path.join(process.cwd(), 'app', 'index.html'),
    // Optional loading indicator page, mounted before the page renders.
    loadingFile = path.join(process.cwd(), 'app', 'loading.tyx'),
    // Compiler language switches, e.g. { not: 'loose' }. Omitted means
    // legacy behaviour, so existing callers compile unchanged.
    language: languageOption = {},
    // false turns off the built-in top loading bar. A project loading page
    // (app/loading.tyx) also replaces it.
    loadingBar = true,
  } = {},
) {
  // createApp already has a variable called `language` that holds
  // 'typescript' | 'javascript'. Passing that here would silently fall
  // back to the defaults, so refuse it loudly instead.
  if (languageOption !== null && typeof languageOption !== 'object') {
    throw new Error(
      `renderPageDocument: the "language" option must be an object like { not: 'loose' }, got ${typeof languageOption} "${languageOption}". ` +
        'The project language ("typescript"/"javascript") is a different setting.',
    )
  }
  const language = normalizeLanguageOptions(languageOption ?? {})

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
      ? parseScriptWithLineOffset(script, scriptStartLine, language)
      : EMPTY_PAGE,
  )

  const classSource = generatePage(pageNode, pageName)

  const templateNodes = parseTemplateWithLineOffset(
    template,
    templateStartLine,
    language,
  )
  const { code, rootVar } = generateTemplate(templateNodes)

  const capabilityDefinitions = await loadCapabilityDefinitions(
    capabilitiesDir,
    language,
  )
  const headTags = await loadHeadTags(headFile)
  const shell = await loadShell(shellFile)

  // The loading page is compiled like a layout and mounted before the
  // page's own data requests start, so the very first request shows it.
  // It receives the shared loading state (see runtime/loadingIndicator.js)
  // as its "loading" prop. A failure while mounting it is logged and never
  // blocks the page.
  const loadingSource = await loadLoadingPage(loadingFile)
  let loadingClassSource = ''
  let loadingMountCode = ''
  if (loadingSource !== null) {
    let loadingCompiled
    try {
      loadingCompiled = compileComponentSource(
        loadingSource,
        '__Loading',
        language,
      )
    } catch (err) {
      err.message = `In app/loading.tyx: ${err.message}`
      throw err
    }
    loadingClassSource = loadingCompiled.classSource
    loadingMountCode = `
    try {
      const loadingInstance = new ${loadingCompiled.className}({ loading: __tylixLoading });
      (function (document, instance) {
${loadingCompiled.code}
        document.body.appendChild(${loadingCompiled.rootVar});
      })(document, loadingInstance);
      if (typeof loadingInstance.__onMount === "function") {
        Promise.resolve(loadingInstance.__onMount()).catch((err) => {
          console.error("loading page onMount failed:", err);
        });
      }
    } catch (err) {
      console.error("loading page failed:", err);
    }`
  }

  // Each child is compiled exactly once, under a unique class name
  // derived from its registry key (the tag name the page uses), not
  // from whatever `component X` line the file declares.
  const childNames = Object.keys(childComponents)
  const compiledChildren = childNames.map((name, i) => {
    try {
      return compileComponentSource(
        childComponents[name],
        childClassName(name, i),
        language,
      )
    } catch (err) {
      err.message = `In component <${name}>: ${err.message}`
      throw err
    }
  })
  const childClassSources = compiledChildren
    .map((c) => c.classSource)
    .join('\n\n')

  const childRegistrations = compiledChildren
    .map((compiled, i) => {
      const name = childNames[i]
      const label = JSON.stringify(name)
      const { code: childCode, rootVar: childRootVar, className } = compiled
      return `  components[${label}] = {
    mount(document, props = {}) {
      const instance = new ${className}(props);
      const node = (function (document, instance) {
${childCode}
        return ${childRootVar};
      })(document, instance);
      // needs/prefetch first, then onMount, same order as pages.
      // Runs a microtask later, after the caller has attached the node.
      Promise.resolve()
        .then(() => (typeof instance.__ready === "function" ? instance.__ready() : null))
        .catch((err) => console.error("component ready failed (" + ${label} + "):", err))
        .then(() => (typeof instance.__onMount === "function" ? instance.__onMount() : null))
        .catch((err) => console.error("component onMount failed (" + ${label} + "):", err));
      return { node, instance };
    },
  };`
    })
    .join('\n\n')

  let layoutClassSource = ''
  let layoutMountCode = `document.getElementById("app").appendChild(${rootVar});`

  if (layout !== null) {
    let layoutCompiled
    try {
      layoutCompiled = compileComponentSource(layout, '__Layout', language)
    } catch (err) {
      err.message = `In _layout.tyx: ${err.message}`
      throw err
    }
    layoutClassSource = layoutCompiled.classSource
    layoutMountCode = `
    const layoutInstance = new ${layoutCompiled.className}();
    if (typeof layoutInstance.__ready === "function") {
      try {
        await layoutInstance.__ready();
      } catch (err) {
        console.error("layout ready failed:", err);
      }
    }
    (function (document, instance, pageRoot) {
${layoutCompiled.code}
      const slot = ${layoutCompiled.rootVar}.querySelector("[data-tylix-slot]");
      if (!slot) {
        throw new Error("_layout.tyx is missing a data-tylix-slot element");
      }
      slot.appendChild(pageRoot);
      document.getElementById("app").appendChild(${layoutCompiled.rootVar});
    })(document, layoutInstance, ${rootVar});
    if (typeof layoutInstance.__onMount === "function") {
      try {
        await layoutInstance.__onMount();
      } catch (err) {
        console.error("layout onMount failed:", err);
      }
    }`
  }

  const channelsPortScript =
    channelsPort !== null
      ? `<script>window.__TYLIX_CHANNELS_PORT__ = ${JSON.stringify(channelsPort)};</script>`
      : ''

  // If __ready() rejects (a failed needs/prefetch call), log it and keep
  // going so the page still renders, instead of showing a blank screen.
  const inlineScript = `
${loadingClassSource || !loadingBar ? 'window.__TYLIX_CUSTOM_LOADING__ = true;' : ''}

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

${loadingClassSource}

document.addEventListener("DOMContentLoaded", () => {
  const instance = new ${pageName}(${JSON.stringify(props)});
  const components = {};
${childRegistrations}
  (async function (document, instance, components) {
${loadingMountCode}
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
    { name: 'loading page', code: loadingClassSource },
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

  // A "</script" anywhere in the generated code (a <pre> sample, a
  // route prop, a string) would end the script element early, and
  // "<!--" can start an HTML comment inside it. Both replacements mean
  // the same thing to the JS engine. Done AFTER the validation above,
  // which must see the unescaped source.
  const safeScript = inlineScript
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/<!--/g, '<\\!--')

  const themeScript = `<script>
    (function () {
      var stored = localStorage.getItem("theme");
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (stored === "dark" || (!stored && prefersDark)) {
        document.documentElement.classList.add("dark");
      }
    })();
  </script>`

  const values = {
    title: escapeHtml(pageNode.title ?? pageName),
    head: [channelsPortScript, themeScript, styleLinks, headTags, styleTag]
      .filter((part) => part && part.length > 0)
      .join('\n  '),
    body: `<div id="app"></div>\n  <script>${safeScript}</script>`,
  }

  // One pass with a function replacer, so a "$&" or a placeholder-looking
  // string inside the generated script is never treated as a pattern or
  // substituted a second time.
  return shell.replace(/%tylix\.(title|head|body)%/g, (_, key) => values[key])
}