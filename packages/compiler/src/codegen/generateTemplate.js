import { generateTemplateExpression } from "./generateTemplateExpression.js";

const EVENT_ATTR_PREFIX = /^on(click|input|change|submit)$/i;

let nodeCounter = 0;
function nextVar(prefix) {
  return `${prefix}${nodeCounter++}`;
}

/**
 * Compiles a template AST (array of Element/Text/Interpolation nodes)
 * into the BODY of a `render(instance, document)` function as a JS
 * source string. The generated code builds real DOM nodes directly
 * (no virtual DOM) and wraps only the parts that read reactive state
 * in effect(), so a state change updates exactly the text node or
 * attribute that depends on it -- never a full subtree re-render.
 *
 * Returns { code, rootVar }: `code` is the statements to run, and
 * `rootVar` names the variable holding the root DOM node to mount.
 */
export function generateTemplate(nodes) {
  nodeCounter = 0;
  const lines = [];
  const rootVars = nodes.map((node) => compileNode(node, lines));

  if (rootVars.length === 1) {
    return { code: lines.join("\n"), rootVar: rootVars[0] };
  }

  // Multiple top-level nodes: wrap them in a fragment-like container.
  const fragmentVar = nextVar("fragment");
  lines.push(`const ${fragmentVar} = document.createDocumentFragment();`);
  rootVars.forEach((v) => lines.push(`${fragmentVar}.appendChild(${v});`));
  return { code: lines.join("\n"), rootVar: fragmentVar };
}

function compileNode(node, lines) {
  if (node.type === "Text") {
    const varName = nextVar("text");
    lines.push(`const ${varName} = document.createTextNode(${JSON.stringify(node.value)});`);
    return varName;
  }

  if (node.type === "Interpolation") {
    const varName = nextVar("text");
    const expr = generateTemplateExpression(node.expression);
    lines.push(`const ${varName} = document.createTextNode("");`);
    lines.push(`effect(() => { ${varName}.nodeValue = ${expr}; });`);
    return varName;
  }

  if (node.type === "Element") {
    return compileElement(node, lines);
  }

  throw new Error(`generateTemplate: unknown node type "${node.type}"`);
}

const COMPONENT_TAG_PATTERN = /^[A-Z]/;

function isComponentTag(tag) {
  return COMPONENT_TAG_PATTERN.test(tag);
}

function compileElement(node, lines) {
  if (isComponentTag(node.tag)) {
    return compileComponentReference(node, lines);
  }

  const varName = nextVar("el");
  lines.push(`const ${varName} = document.createElement(${JSON.stringify(node.tag)});`);

  for (const attr of node.attributes) {
    compileAttribute(varName, attr, lines);
  }

  for (const child of node.children) {
    const childVar = compileNode(child, lines);
    lines.push(`${varName}.appendChild(${childVar});`);
  }

  return varName;
}

// A capitalized tag (<Counter />) is a reference to another compiled
// component, looked up by name in the `components` map passed into
// the render function's scope. Mounting it returns its root DOM node,
// which is inserted here exactly like any other child.
function compileComponentReference(node, lines) {
  const varName = nextVar("component");
  const componentName = JSON.stringify(node.tag);
  lines.push(
    `const ${varName} = components[${componentName}].mount(document).node;`
  );
  return varName;
}

function compileAttribute(elVar, attr, lines) {
  if (EVENT_ATTR_PREFIX.test(attr.name)) {
    const eventName = attr.name.slice(2).toLowerCase();
    if (!attr.dynamic) {
      throw new Error(`Event attribute "${attr.name}" must use {{ }} binding, got a static string.`);
    }
    const expr = generateTemplateExpression(attr.value);
    lines.push(`${elVar}.addEventListener(${JSON.stringify(eventName)}, (event) => { ${expr}(event); });`);
    return;
  }

  if (attr.dynamic) {
    const expr = generateTemplateExpression(attr.value);
    lines.push(`effect(() => { ${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${expr}); });`);
    return;
  }

  lines.push(`${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`);
}
