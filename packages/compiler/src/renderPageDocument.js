import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseComponent } from "./parser/parseComponent.js";
import { parseTemplate } from "./parser/parseTemplate.js";
import { Lexer } from "./lexer/Lexer.js";
import { Parser } from "./parser/Parser.js";
import { generatePage } from "./codegen/generatePage.js";
import { generateTemplate } from "./codegen/generateTemplate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SOURCE = fs
  .readFileSync(path.join(__dirname, "runtime", "reactive.js"), "utf-8")
  // Strip ES module export keywords: this file is inlined into a plain
  // <script> tag in the browser, not loaded as a module, so `reactive`
  // and `effect` just become ordinary top-level functions in scope.
  .replace(/export\s+/g, "");

/**
 * Compiles raw .tyx source into a complete, self-contained HTML
 * document string: the reactive runtime, the compiled component class,
 * and the compiled render function are all inlined into one <script>
 * tag that mounts the component into #app on load. No build step, no
 * bundler, no separate JS file to serve -- exactly what "tylix dev"
 * needs to hand back for a GET request to a page route.
 */
export function renderPageDocument(source, { title = "Tylix App", className = "Page" } = {}) {
  const { script, template, style } = parseComponent(source);

  const pageNode = script.trim().length > 0
    ? new Parser(new Lexer(script).tokenize()).parse()
    : { props: [], state: [], computed: [], actions: [] };

  const classSource = generatePage(pageNode, className);

  const templateNodes = parseTemplate(template);
  const { code, rootVar } = generateTemplate(templateNodes);

  const inlineScript = `
${RUNTIME_SOURCE}

${classSource}

document.addEventListener("DOMContentLoaded", () => {
  const instance = new ${className}();
  (function (document, instance) {
${code}
    document.getElementById("app").appendChild(${rootVar});
  })(document, instance);
});
`;

  const styleTag = style.trim().length > 0 ? `<style>\n${style}\n</style>` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  ${styleTag}
</head>
<body>
  <div id="app"></div>
  <script>${inlineScript}</script>
</body>
</html>`;
}
