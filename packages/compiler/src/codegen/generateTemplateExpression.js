import { generateExpression } from "./generateExpression.js";

/**
 * Like generateExpression, but every Identifier is prefixed with
 * "instance." UNLESS it's a local name in `scope` (e.g. an
 * {{#each item in items}} loop variable), in which case it's left
 * bare -- it refers to the JS for-of loop variable, not a component
 * instance property.
 */
export function generateTemplateExpression(node, scope = new Set()) {
  if (node.type === "Identifier") {
    return scope.has(node.name) ? node.name : `instance.${node.name}`;
  }
  if (node.type === "MemberExpression") {
    return `${generateTemplateExpression(node.object, scope)}.${node.property}`;
  }
  if (node.type === "BinaryExpression") {
    return `(${generateTemplateExpression(node.left, scope)} ${node.operator} ${generateTemplateExpression(node.right, scope)})`;
  }
  if (node.type === "CallExpression") {
    const args = node.args.map((a) => generateTemplateExpression(a, scope)).join(", ");
    return `${generateTemplateExpression(node.callee, scope)}(${args})`;
  }
  if (node.type === "Literal") {
    return generateExpression(node);
  }
  throw new Error(`generateTemplateExpression: unsupported node type "${node.type}" in template expression`);
}
