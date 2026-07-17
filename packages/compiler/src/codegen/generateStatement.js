import { generateExpression } from './generateExpression.js'

/**
 * Compiles a single statement AST node into a JS source line.
 */
export function generateStatement(node) {
  switch (node.type) {
    case 'ReturnStatement':
      return `return ${generateExpression(node.argument)};`

    case 'ExpressionStatement':
      return `${generateExpression(node.expression)};`

    case 'VariableDeclaration':
      return `${node.kind} ${node.name} = ${generateExpression(node.init)};`

    case 'IfStatement': {
      const cond = generateExpression(node.condition)
      const body = node.consequent
        .map((s) => `    ${generateStatement(s)}`)
        .join('\n')
      let out = `if (${cond}) {\n${body}\n  }`
      if (node.alternate) {
        const elseBody = node.alternate
          .map((s) => `    ${generateStatement(s)}`)
          .join('\n')
        out += ` else {\n${elseBody}\n  }`
      }
      return out
    }

    case 'ForInStatement': {
      const body = node.body
        .map((s) => `    ${generateStatement(s)}`)
        .join('\n')
      return `for (const ${node.varName} of ${generateExpression(node.iterable)}) {\n${body}\n  }`
    }

    case 'ForRangeStatement': {
      const body = node.body
        .map((s) => `    ${generateStatement(s)}`)
        .join('\n')
      return `for (let ${node.varName} = ${generateExpression(node.start)}; ${node.varName} < ${generateExpression(node.end)}; ${node.varName}++) {\n${body}\n  }`
    }

    case 'RepeatStatement': {
      const body = node.body
        .map((s) => `    ${generateStatement(s)}`)
        .join('\n')
      return `for (let __i = 0; __i < ${generateExpression(node.count)}; __i++) {\n${body}\n  }`
    }

    case 'BreakStatement':
      return 'break;'

    case 'ContinueStatement':
      return 'continue;'

    default:
      throw new Error(`generateStatement: unknown node type "${node.type}"`)
  }
}
