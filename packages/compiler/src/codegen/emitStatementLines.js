import {
  declarationSource,
  forHeaderSource,
  generateDeclarationTarget,
  generateStatement,
} from './generateStatement.js'

import { generateExpression, generateParams, functionSignature } from './generateExpression.js'

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
// there's no "untyped" mode to preserve here. Binding-target and
// declaration rendering is shared with generateStatement.js.
//
// Block-bodied arrows never reach this file directly: they are
// emitted by generateExpression, which delegates their statements to
// generateStatement (typed). A standalone `{ ... }` block statement
// does reach it and is handled below.
export function emitStatementLines(node, sink, indent = '    ') {
  const line = node.line
  const push = (text) => sink.pushLine(`${indent}${text}`, line)
  const expr = (n) => generateExpression(n, true)
  const nested = (list) => {
    for (const s of list) emitStatementLines(s, sink, indent + '  ')
  }

  switch (node.type) {
    case 'EmptyStatement':
      push(';')
      break

    case 'DebuggerStatement':
      push('debugger;')
      break

    case 'BlockStatement':
      push('{')
      nested(node.body)
      push('}')
      break

    // The label sits on its own line, directly above its statement.
    case 'LabeledStatement':
      push(`${node.label}:`)
      emitStatementLines(node.body, sink, indent)
      break

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
      push(`${declarationSource(node, true)};`)
      break

    // A class is rendered by generateStatement as one multi-line
    // string; split it so every generated line gets its own lineMap
    // entry (embedded newlines would shift all later line numbers).
    case 'ClassDeclaration':
      for (const text of generateStatement(node, true).split('\n')) push(text)
      break

       case 'TypeDeclaration':
      push(node.source)
      break

    case 'EnumDeclaration':
      push(generateStatement(node, true))
      break

    case 'FunctionDeclaration': {
      const { generics, ret } = functionSignature(node, true)
      const head = `${node.isAsync ? 'async ' : ''}function${node.isGenerator ? '*' : ''} ${node.name}${generics}(${generateParams(node.params, true)})${ret}`
      if (node.body == null) {
        push(`${head};`) // overload signature
        break
      }
      push(`${head} {`)
      nested(node.body)
      push('}')
      break
    }

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

    case 'DoWhileStatement':
      push('do {')
      nested(node.body)
      push(`} while (${expr(node.condition)});`)
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
      push(
        `for ${node.isAwait ? 'await ' : ''}(${node.declKind ?? 'const'} ${generateDeclarationTarget(node.varName, true)} of ${expr(node.iterable)}) {`,
      )
      nested(node.body)
      push('}')
      break

    case 'ForKeysStatement':
      push(
        `for (${node.declKind ?? 'const'} ${generateDeclarationTarget(node.varName, true)} in ${expr(node.object)}) {`,
      )
      nested(node.body)
      push('}')
      break

    case 'ForStatement':
      push(`for (${forHeaderSource(node, true)}) {`)
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
      push(node.label ? `break ${node.label};` : 'break;')
      break

    case 'ContinueStatement':
      push(node.label ? `continue ${node.label};` : 'continue;')
      break

    case 'TryStatement':
      push('try {')
      nested(node.tryBlock)
      if (node.catchBlock) {
        if (node.catchParam == null) {
          push('} catch {')
        } else if (typeof node.catchParam === 'string') {
          // JS gives the catch variable `any` semantics; TypeScript's
          // default under strict is `unknown`.
          push(`} catch (${node.catchParam}: ${node.catchType ?? 'any'}) {`)
        } else {
          push('} catch (__caught: any) {')
          push(
            `  const ${generateDeclarationTarget(node.catchParam, true)} = __caught;`,
          )
        }
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