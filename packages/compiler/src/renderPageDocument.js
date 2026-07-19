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

// Components come in two dialects: the tag-based <script>/<template>
// format (parseComponent.js -- used by _layout.tyx and older child
// components), and the bare-keyword "component Name" format (mirrors
// "page Name" pages). Detected by whether the source starts with the
// literal "component" keyword.
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

export function renderPageDocument(
  source,
  childComponents = {},
  { layout = null, props = {} } = {},
) {
  const { pageName, script, template, style } = parsePageFile(source)

  const pageNode =
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize()).parse()
      : { props: [], state: [], computed: [], actions: [] }

  const classSource = generatePage(pageNode, pageName)

  const templateNodes = parseTemplate(template)
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
    mount(document) {
      const instance = new ${className}();
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

  const inlineScript = `
${RUNTIME_SOURCE}

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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
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
