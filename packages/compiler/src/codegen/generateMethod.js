import { generateStatement } from "./generateStatement.js";

/**
 * Compiles a MethodNode (used for both `computed` and `action` entries)
 * into a JS class method source string, indented for readability in
 * generated output.
 */
export function generateMethod(node) {
  const params = node.params.join(", ");
  const body = node.body.map((stmt) => `    ${generateStatement(stmt)}`).join("\n");
  return `  ${node.name}(${params}) {\n${body}\n  }`;
}
