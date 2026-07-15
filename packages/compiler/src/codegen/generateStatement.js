import { generateExpression } from "./generateExpression.js";

/**
 * Compiles a single statement AST node into a JS source line.
 */
export function generateStatement(node) {
  switch (node.type) {
    case "ReturnStatement":
      return `return ${generateExpression(node.argument)};`;

    case "ExpressionStatement":
      return `${generateExpression(node.expression)};`;

    case "VariableDeclaration":
      return `${node.kind} ${node.name} = ${generateExpression(node.init)};`;

    default:
      throw new Error(`generateStatement: unknown node type "${node.type}"`);
  }
}
