import { generateExpression } from "./generateExpression.js";

/**
 * Like generateExpression, but every Identifier is treated as an
 * instance member reference and prefixed with "instance.". Inside a
 * method body, "this.count" is written explicitly by the developer;
 * inside a template interpolation ("{{ count }}"), there's no "this"
 * to write, so every bare identifier implicitly means "the component
 * instance's count".
 */
export function generateTemplateExpression(node) {
  if (node.type === "Identifier") {
    return `instance.${node.name}`;
  }
  if (node.type === "MemberExpression") {
    return `${generateTemplateExpression(node.object)}.${node.property}`;
  }
  if (node.type === "BinaryExpression") {
    return `(${generateTemplateExpression(node.left)} ${node.operator} ${generateTemplateExpression(node.right)})`;
  }
  if (node.type === "Literal") {
    return generateExpression(node);
  }
  throw new Error(`generateTemplateExpression: unsupported node type "${node.type}" in template expression`);
}
