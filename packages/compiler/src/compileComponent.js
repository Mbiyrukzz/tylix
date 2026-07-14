import { parseComponent } from "./parser/parseComponent.js";
import { parseTemplate } from "./parser/parseTemplate.js";
import { Lexer } from "./lexer/Lexer.js";
import { Parser } from "./parser/Parser.js";
import { generatePage } from "./codegen/generatePage.js";
import { generateTemplate } from "./codegen/generateTemplate.js";
import { reactive, effect } from "./runtime/reactive.js";

/**
 * Compiles raw .tyx source into a mountable component descriptor.
 *
 *   const Component = compileComponent(source, "Counter");
 *   const node = Component.mount(document);
 *   document.body.appendChild(node);
 *
 * A script section is optional -- a template-only .tyx file compiles
 * to a component with no state/actions, just static (or interpolation-
 * free) markup.
 */
export function compileComponent(source, className = "Component") {
  const { script, template } = parseComponent(source);

  const pageNode = script.trim().length > 0
    ? new Parser(new Lexer(script).tokenize()).parse()
    : { props: [], state: [], computed: [], actions: [] };

  const classSource = generatePage(pageNode, className);
  const ComponentClass = new Function("reactive", `return ${classSource}`)(reactive);

  const templateNodes = parseTemplate(template);
  const { code, rootVar } = generateTemplate(templateNodes);

  return {
    ComponentClass,
    mount(document) {
      const instance = new ComponentClass();
      const renderFn = new Function(
        "document",
        "effect",
        "instance",
        `${code}\nreturn ${rootVar};`
      );
      const node = renderFn(document, effect, instance);
      return { node, instance };
    },
  };
}
