import { generateExpression } from './generateExpression.js'

// Structurally the same cases as generateStatement.js, but emits one
// line at a time through `sink.pushLine(text, originalLine)` instead
// of returning a single joined string -- needed so the virtual .ts
// builder can record a lineMap entry per generated line, not just
// per top-level declaration. Kept separate from generateStatement
// rather than instrumented in place, since the real JS codegen path
// has no use for per-line source positions.
//
// Every generateExpression() call here passes `true` for its typed
// param -- this file has exactly one consumer (buildVirtualPageTs,
// building the virtual .ts fed to the TypeScript compiler API), so
// unlike generateExpression itself (shared between real JS and
// virtual TS output), there's no "untyped" mode to preserve here.
//
// Block-bodied arrows never reach this file directly: they are
// emitted by generateExpression, which delegates their statements to
// generateStatement (typed), so there is no BlockStatement case here.
export function emitStatementLines(node, sink, indent = '    ') {
  const line = node.line
  const push = (text) => sink.pushLine(`${indent}${text}`, line)
  const expr = (n) => generateExpression(n, true)
  const nested = (list) => {
    for (const s of list) emitStatementLines(s, sink, indent + '  ')
  }

  switch (node.type) {
    case 'ReturnStatement':
      push(node.argument ? `return ${expr(node.argument)};` : 'return;')
      break

    case 'ThrowStatement':
      push(`throw ${expr(node.argument)};`)
      break

    case 'ExpressionStatement':
      push(`${expr(node.expression)};`)
      break

    case 'VariableDeclaration':
      push(
        `${node.kind} ${generateDeclarationTarget(node.name)} = ${expr(node.init)};`,
      )
      break

    case 'IfStatement':
      push(`if (${expr(node.condition)}) {`)
      nested(node.consequent)
      if (node.alternate) {
        push('} else {')
        nested(node.alternate)
      }
      push('}')
      break

    case 'WhileStatement':
      push(`while (${expr(node.condition)}) {`)
      nested(node.body)
      push('}')
      break

    // Mirrors generateStatement: every clause body sits in its own
    // braces and ends with an automatic `break`, so the virtual file
    // has the same scoping and no-fallthrough behavior as real output.
    case 'SwitchStatement':
      push(`switch (${expr(node.discriminant)}) {`)
      for (const c of node.cases) {
        if (c.tests === null) {
          push('  default: {')
        } else {
          c.tests.forEach((t, i) => {
            const isLast = i === c.tests.length - 1
            push(`  case ${expr(t)}:${isLast ? ' {' : ''}`)
          })
        }
        for (const s of c.body) emitStatementLines(s, sink, indent + '    ')
        push('    break;')
        push('  }')
      }
      push('}')
      break

    case 'ForInStatement':
      push(`for (const ${node.varName} of ${expr(node.iterable)}) {`)
      nested(node.body)
      push('}')
      break

    case 'ForRangeStatement':
      push(
        `for (let ${node.varName} = ${expr(node.start)}; ${node.varName} < ${expr(node.end)}; ${node.varName}++) {`,
      )
      nested(node.body)
      push('}')
      break

    case 'RepeatStatement':
      push(`for (let __i = 0; __i < ${expr(node.count)}; __i++) {`)
      nested(node.body)
      push('}')
      break

    case 'BreakStatement':
      push('break;')
      break

    case 'ContinueStatement':
      push('continue;')
      break

    case 'TryStatement':
      push('try {')
      nested(node.tryBlock)
      if (node.catchBlock) {
        push(node.catchParam ? `} catch (${node.catchParam}) {` : '} catch {')
        nested(node.catchBlock)
      }
      if (node.finallyBlock) {
        push('} finally {')
        nested(node.finallyBlock)
      }
      push('}')
      break

    default:
      throw new Error(`emitStatementLines: unknown node type "${node.type}"`)
  }
}

// Same binding-target rendering as generateStatement.js (kept as a
// local copy so that file's exports stay untouched): a plain
// identifier, or a nested ObjectPattern/ArrayPattern with renames,
// defaults and rest elements. If you change one, change both.
function generateDeclarationTarget(target) {
  if (typeof target === 'string') {
    return target
  }

  if (target.type === 'ObjectPattern') {
    const parts = target.properties.map((p) => {
      const bindingStr = generateDeclarationTarget(p.binding)
      const needsColon = typeof p.binding !== 'string' || p.binding !== p.key
      const lhs = needsColon ? `${p.key}: ${bindingStr}` : p.key
      return p.defaultValue
        ? `${lhs} = ${generateExpression(p.defaultValue, true)}`
        : lhs
    })
    if (target.rest) {
      parts.push(`...${target.rest}`)
    }
    return `{ ${parts.join(', ')} }`
  }

  if (target.type === 'ArrayPattern') {
    const parts = target.elements.map((el) => {
      if (el === null) return ''
      const bindingStr = generateDeclarationTarget(el.binding)
      return el.defaultValue
        ? `${bindingStr} = ${generateExpression(el.defaultValue, true)}`
        : bindingStr
    })
    if (target.rest) {
      parts.push(`...${target.rest}`)
    }
    return `[${parts.join(', ')}]`
  }

  throw new Error(
    `generateDeclarationTarget: unknown pattern type "${target.type}"`,
  )
}