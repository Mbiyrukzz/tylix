import { generateExpression } from './generateExpression.js'

/**
 * Compiles a single statement AST node into a JS source line.
 *
 * `typed` is threaded through to generateExpression so a block-bodied
 * arrow compiled for the virtual .ts file keeps its `: any` param
 * annotations on nested arrows. It defaults to false, so every
 * existing caller (generateMethod, generateCapability) is unchanged.
 */
export function generateStatement(node, typed = false) {
  const expr = (n) => generateExpression(n, typed)
  const stmts = (list) =>
    list.map((s) => `    ${generateStatement(s, typed)}`).join('\n')

  switch (node.type) {
    case 'ReturnStatement':
      return node.argument ? `return ${expr(node.argument)};` : 'return;'

    case 'ThrowStatement':
      return `throw ${expr(node.argument)};`

    case 'ExpressionStatement':
      return `${expr(node.expression)};`

    case 'VariableDeclaration':
      return `${node.kind} ${generateDeclarationTarget(node.name, typed)} = ${expr(node.init)};`

    case 'IfStatement': {
      let out = `if (${expr(node.condition)}) {\n${stmts(node.consequent)}\n  }`
      if (node.alternate) {
        out += ` else {\n${stmts(node.alternate)}\n  }`
      }
      return out
    }

    case 'WhileStatement':
      return `while (${expr(node.condition)}) {\n${stmts(node.body)}\n  }`

    // Each clause body is wrapped in its own braces so `const`/`let`
    // declared in one case can't collide with another, and a `break`
    // is appended so there is never accidental fallthrough. (A
    // user-written `break` inside a case therefore leaves the switch,
    // not an enclosing loop -- same as JS.)
    case 'SwitchStatement': {
      const clauses = node.cases.map((c) => {
        const labels =
          c.tests === null
            ? '    default:'
            : c.tests.map((t) => `    case ${expr(t)}:`).join('\n')
        return `${labels} {\n${stmts(c.body)}\n      break;\n    }`
      })
      return `switch (${expr(node.discriminant)}) {\n${clauses.join('\n')}\n  }`
    }

    case 'ForInStatement':
      return `for (const ${node.varName} of ${expr(node.iterable)}) {\n${stmts(node.body)}\n  }`

    case 'ForRangeStatement':
      return `for (let ${node.varName} = ${expr(node.start)}; ${node.varName} < ${expr(node.end)}; ${node.varName}++) {\n${stmts(node.body)}\n  }`

    case 'RepeatStatement':
      return `for (let __i = 0; __i < ${expr(node.count)}; __i++) {\n${stmts(node.body)}\n  }`

    case 'BreakStatement':
      return 'break;'

    case 'ContinueStatement':
      return 'continue;'

    case 'TryStatement': {
      let out = `try {\n${stmts(node.tryBlock)}\n  }`

      if (node.catchBlock) {
        const catchHeader = node.catchParam
          ? `catch (${node.catchParam})`
          : 'catch'
        out += ` ${catchHeader} {\n${stmts(node.catchBlock)}\n  }`
      }

      if (node.finallyBlock) {
        out += ` finally {\n${stmts(node.finallyBlock)}\n  }`
      }

      return out
    }

    default:
      throw new Error(`generateStatement: unknown node type "${node.type}"`)
  }
}

// Renders a VariableDeclaration's binding target -- a plain identifier
// (the base case), or -- for destructuring -- a nested ObjectPattern/
// ArrayPattern, each with optional per-field renames, defaults, and a
// rest element, recursing through `binding` so patterns can nest
// arbitrarily deep (e.g. `const { data: { id, name } } = result`)
// instead of only supporting one flat level. Matches real JS
// destructuring syntax so the generated line is exactly what a
// hand-written `const { a } = x` would look like.
function generateDeclarationTarget(target, typed = false) {
  if (typeof target === 'string') {
    return target
  }

  if (target.type === 'ObjectPattern') {
    const parts = target.properties.map((p) => {
      const bindingStr = generateDeclarationTarget(p.binding, typed)
      // Only emit "key: binding" when the binding differs from a bare
      // shorthand match on the key itself -- i.e. it was renamed or
      // it's a nested pattern (never just equal to the plain key string).
      const needsColon = typeof p.binding !== 'string' || p.binding !== p.key
      const lhs = needsColon ? `${p.key}: ${bindingStr}` : p.key
      return p.defaultValue
        ? `${lhs} = ${generateExpression(p.defaultValue, typed)}`
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
      const bindingStr = generateDeclarationTarget(el.binding, typed)
      return el.defaultValue
        ? `${bindingStr} = ${generateExpression(el.defaultValue, typed)}`
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