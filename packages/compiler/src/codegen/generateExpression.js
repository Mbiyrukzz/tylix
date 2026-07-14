/**
 * Compiles a single expression AST node into a JS source string.
 * Used both for method-body statements and template interpolations,
 * so every consumer (class codegen, template codegen) shares one
 * source of truth for expression -> JS translation.
 */
export function generateExpression(node) {
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value);

    case "Identifier":
      return node.name;

    case "MemberExpression":
      return `${generateExpression(node.object)}.${node.property}`;

    case "BinaryExpression":
      return `(${generateExpression(node.left)} ${node.operator} ${generateExpression(node.right)})`;

    case "AssignmentExpression":
      return `${generateExpression(node.target)} = ${generateExpression(node.value)}`;

    default:
      throw new Error(`generateExpression: unknown node type "${node.type}"`);
  }
}
