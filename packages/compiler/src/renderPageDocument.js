import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePageFile } from "./parser/parsePageFile.js";
import { parseTemplate } from "./parser/parseTemplate.js";
import { Lexer } from "./lexer/Lexer.js";
import { Parser } from "./parser/Parser.js";
import { generatePage } from "./codegen/generatePage.js";
import { generateTemplate } from "./codegen/generateTemplate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SOURCE = fs
  .readFileSync(path.join(__dirname, "runtime", "reactive.js"), "utf-8")
  .replace(/export\s+/g, "");

/**
 * Compiles a native Tylix .tyx page file (page/state/computed/action/
 * template/style keywords, no wrapper tags) into a complete,
 * self-contained HTML document string. The page name from `page Home`
 * becomes both the document title and the generated class name.
 */
export function renderPageDocument(source) {
  const { pageName, script, template, style } = parsePageFile(source);

  const pageNode = script.trim().length > 0
    ? new Parser(new Lexer(script).tokenize()).parse()
    : { props: [], state: [], computed: [], actions: [] };

  const classSource = generatePage(pageNode, pageName);

  const templateNodes = parseTemplate(template);
  const { code, rootVar } = generateTemplate(templateNodes);

  const inlineScript = `
${RUNTIME_SOURCE}

${classSource}

document.addEventListener("DOMContentLoaded", () => {
  const instance = new ${pageName}();
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
  <title>${pageName}</title>
  ${styleTag}
</head>
<body>
  <div id="app"></div>
  <script>${inlineScript}</script>
</body>
</html>`;
}
