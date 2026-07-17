import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePageFile } from './parser/parsePageFile.js'
import { parseComponent } from './parser/parseComponent.js'
import { parseTemplate } from './parser/parseTemplate.js'
import { Lexer } from './lexer/Lexer.js'
import { Parser } from './parser/Parser.js'
import { generatePage } from './codegen/generatePage.js'
import { generateTemplate } from './codegen/generateTemplate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_SOURCE = fs
  .readFileSync(path.join(__dirname, 'runtime', 'reactive.js'), 'utf-8')
  .replace(/export\s+/g, '')

function compileComponentSource(source, className) {
  const { script, template } = parseComponent(source)

  const pageNode =
    script.trim().length > 0
      ? new Parser(new Lexer(script).tokenize()).parse()
      : { props: [], state: [], computed: [], actions: [] }

  const classSource = generatePage(pageNode, className)
  const templateNodes = parseTemplate(template)
  const { code, rootVar } = generateTemplate(templateNodes)

  return { classSource, code, rootVar }
}

/**
 * Compiles a native Tylix .tyx page file into a complete, self-
 * contained HTML document string. `childComponents` is an optional
 * map of { TagName: rawTyxSource } for any <TagName /> components
 * referenced in the page's template (using the plain <script>/
 * <template> component format, not the page/state/action format,
 * since child components are typically simpler reusable pieces).
 *
 * `layout`, if given, is the raw source of a <script>/<template>
 * component (same format as childComponents) containing an element
 * with a `data-tylix-slot` attribute. The page's own root element is
 * mounted inside that slot instead of directly into #app.
 */
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
      const { code: childCode, rootVar: childRootVar } = compileComponentSource(
        childComponents[name],
        name,
      )
      return `  components[${JSON.stringify(name)}] = {
    mount(document) {
      const instance = new ${name}();
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
    const layoutInstance = new __Layout();
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
