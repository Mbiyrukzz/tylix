import { generateExpression } from './generateExpression.js'

/**
 * Compiles a single statement AST node into a JS source line.
 */
export function generateStatement(node) {
  switch (node.type) {
    case 'ReturnStatement':
      return node.argument
        ? `return ${generateExpression(node.argument)};`
        : 'return;'

    case 'ExpressionStatement':
      return `${generateExpression(node.expression)};`

    case 'VariableDeclaration':
      return `${node.kind} ${generateDeclarationTarget(node.name)} = ${generateExpression(node.init)};`

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

    case 'TryStatement': {
      const tryBody = node.tryBlock
        .map((s) => `    ${generateStatement(s)}`)
        .join('\n')
      let out = `try {\n${tryBody}\n  }`

      if (node.catchBlock) {
        const catchBody = node.catchBlock
          .map((s) => `    ${generateStatement(s)}`)
          .join('\n')
        const catchHeader = node.catchParam
          ? `catch (${node.catchParam})`
          : 'catch'
        out += ` ${catchHeader} {\n${catchBody}\n  }`
      }

      if (node.finallyBlock) {
        const finallyBody = node.finallyBlock
          .map((s) => `    ${generateStatement(s)}`)
          .join('\n')
        out += ` finally {\n${finallyBody}\n  }`
      }

      return out
    }

    default:
      throw new Error(`generateStatement: unknown node type "${node.type}"`)
  }
}

// Renders a VariableDeclaration's binding target -- a plain identifier
// (the pre-existing case, unchanged) or a destructuring pattern
// (ObjectPattern/ArrayPattern), each with optional per-field renames,
// defaults, and a rest element, matching real JS destructuring syntax
// so the generated line is exactly what a hand-written `const { a } = x`
// would look like.
// Renders a VariableDeclaration's binding target -- a plain identifier
// (the base case), or -- for destructuring -- a nested ObjectPattern/
// ArrayPattern, each with optional per-field renames, defaults, and a
// rest element, recursing through `binding` so patterns can nest
// arbitrarily deep (e.g. `const { data: { id, name } } = result`)
// instead of only supporting one flat level.
function generateDeclarationTarget(target) {
  if (typeof target === 'string') {
    return target
  }

  if (target.type === 'ObjectPattern') {
    const parts = target.properties.map((p) => {
      const bindingStr = generateDeclarationTarget(p.binding)
      // Only emit "key: binding" when the binding differs from a bare
      // shorthand match on the key itself -- i.e. it was renamed or
      // it's a nested pattern (never just equal to the plain key string).
      const needsColon = typeof p.binding !== 'string' || p.binding !== p.key
      const lhs = needsColon ? `${p.key}: ${bindingStr}` : p.key
      return p.defaultValue
        ? `${lhs} = ${generateExpression(p.defaultValue)}`
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
        ? `${bindingStr} = ${generateExpression(el.defaultValue)}`
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
