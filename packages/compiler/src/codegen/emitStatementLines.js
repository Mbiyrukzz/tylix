import { generateExpression } from './generateExpression.js'

// Structurally the same cases as generateStatement.js, but emits one
// line at a time through `sink.pushLine(text, originalLine)` instead
// of returning a single joined string -- needed so the virtual .ts
// builder can record a lineMap entry per generated line, not just
// per top-level declaration. Kept separate from generateStatement
// rather than instrumented in place, since the real JS codegen path
// has no use for per-line source positions.
export function emitStatementLines(node, sink, indent = '    ') {
  const line = node.line
  const push = (text) => sink.pushLine(`${indent}${text}`, line)

  switch (node.type) {
    case 'ReturnStatement':
      push(
        node.argument
          ? `return ${generateExpression(node.argument)};`
          : 'return;',
      )
      break

    case 'ExpressionStatement':
      push(`${generateExpression(node.expression)};`)
      break

    case 'VariableDeclaration':
      push(`${node.kind} ${node.name} = ${generateExpression(node.init)};`)
      break

    case 'IfStatement':
      push(`if (${generateExpression(node.condition)}) {`)
      for (const s of node.consequent)
        emitStatementLines(s, sink, indent + '  ')
      if (node.alternate) {
        push('} else {')
        for (const s of node.alternate)
          emitStatementLines(s, sink, indent + '  ')
      }
      push('}')
      break

    case 'ForInStatement':
      push(
        `for (const ${node.varName} of ${generateExpression(node.iterable)}) {`,
      )
      for (const s of node.body) emitStatementLines(s, sink, indent + '  ')
      push('}')
      break

    case 'ForRangeStatement':
      push(
        `for (let ${node.varName} = ${generateExpression(node.start)}; ${node.varName} < ${generateExpression(node.end)}; ${node.varName}++) {`,
      )
      for (const s of node.body) emitStatementLines(s, sink, indent + '  ')
      push('}')
      break

    case 'RepeatStatement':
      push(
        `for (let __i = 0; __i < ${generateExpression(node.count)}; __i++) {`,
      )
      for (const s of node.body) emitStatementLines(s, sink, indent + '  ')
      push('}')
      break

    case 'BreakStatement':
      push('break;')
      break

    case 'ContinueStatement':
      push('continue;')
      break

    default:
      throw new Error(`emitStatementLines: unknown node type "${node.type}"`)
  }
}
