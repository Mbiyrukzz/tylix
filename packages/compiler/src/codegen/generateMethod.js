import { generateStatement } from './generateStatement.js'
import { generateParams } from './generateExpression.js'

/**
 * Compiles a MethodNode (used for both `computed` and `action` entries)
 * into a JS class method source string, indented for readability in
 * generated output. Parameters may have defaults (`page = 1`) and rest
 * (`...args`).
 */
export function generateMethod(node) {
  const params = generateParams(node.params)
  const body = node.body
    .map((stmt) => `    ${generateStatement(stmt)}`)
    .join('\n')
  const asyncPrefix = node.isAsync ? 'async ' : ''
  return `  ${asyncPrefix}${node.name}(${params}) {\n${body}\n  }`
}