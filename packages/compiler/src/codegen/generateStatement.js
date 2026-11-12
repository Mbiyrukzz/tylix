import {
  generateExpression,
  generateParams,
  generateClass,
} from './generateExpression.js'

/**
 * Compiles a single statement AST node into a JS source line.
 *
 * `typed` is threaded through to generateExpression so a block-bodied
 * arrow compiled for the virtual .ts file keeps its `: any` param
 * annotations on nested arrows, and so local declarations keep their
 * `: Type`. It defaults to false, so every existing caller
 * (generateMethod, generateCapability) is unchanged.
 */
export function generateStatement(node, typed = false) {
  const expr = (n) => generateExpression(n, typed)
  const stmts = (list) =>
    list.map((s) => `    ${generateStatement(s, typed)}`).join('\n')

  switch (node.type) {
    case 'EmptyStatement':
      return ';'

    case 'DebuggerStatement':
      return 'debugger;'

    case 'BlockStatement':
      return `{\n${stmts(node.body)}\n  }`

    case 'LabeledStatement':
      return `${node.label}: ${generateStatement(node.body, typed)}`

    case 'ReturnStatement':
      return node.argument ? `return ${expr(node.argument)};` : 'return;'

    case 'ThrowStatement':
      return `throw ${expr(node.argument)};`

    case 'ExpressionStatement':
      return `${expr(node.expression)};`

    case 'VariableDeclaration':
      return `${declarationSource(node, typed)};`

    case 'ClassDeclaration':
      return generateClass(node, typed)

    case 'FunctionDeclaration':
      return `${node.isAsync ? 'async ' : ''}function${node.isGenerator ? '*' : ''} ${node.name}(${generateParams(node.params, typed)}) {\n${stmts(node.body)}\n  }`

    case 'IfStatement': {
      let out = `if (${expr(node.condition)}) {\n${stmts(node.consequent)}\n  }`
      if (node.alternate) {
        out += ` else {\n${stmts(node.alternate)}\n  }`
      }
      return out
    }

    case 'WhileStatement':
      return `while (${expr(node.condition)}) {\n${stmts(node.body)}\n  }`

    case 'DoWhileStatement':
      return `do {\n${stmts(node.body)}\n  } while (${expr(node.condition)});`

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
      return `for ${node.isAwait ? 'await ' : ''}(${node.declKind ?? 'const'} ${generateDeclarationTarget(node.varName, typed)} of ${expr(node.iterable)}) {\n${stmts(node.body)}\n  }`

    case 'ForKeysStatement':
      return `for (${node.declKind ?? 'const'} ${generateDeclarationTarget(node.varName, typed)} in ${expr(node.object)}) {\n${stmts(node.body)}\n  }`

    case 'ForStatement':
      return `for (${forHeaderSource(node, typed)}) {\n${stmts(node.body)}\n  }`

    case 'ForRangeStatement':
      return `for (let ${node.varName} = ${expr(node.start)}; ${node.varName} < ${expr(node.end)}; ${node.varName}++) {\n${stmts(node.body)}\n  }`

    case 'RepeatStatement':
      return `for (let __i = 0; __i < ${expr(node.count)}; __i++) {\n${stmts(node.body)}\n  }`

    case 'BreakStatement':
      return node.label ? `break ${node.label};` : 'break;'

    case 'ContinueStatement':
      return node.label ? `continue ${node.label};` : 'continue;'

    case 'TryStatement': {
      let out = `try {\n${stmts(node.tryBlock)}\n  }`

      if (node.catchBlock) {
        let header = 'catch'
        let prelude = ''
        if (node.catchParam != null) {
          if (typeof node.catchParam === 'string') {
            // Typed: JS gives the catch variable `any` semantics, so
            // the virtual file does too (TypeScript's default would
            // be `unknown` under strict).
            header = typed
              ? `catch (${node.catchParam}: ${node.catchType ?? 'any'})`
              : `catch (${node.catchParam})`
          } else if (typed) {
            // TypeScript forbids a destructuring pattern directly in
            // a catch clause with a type, so bind it on the next line.
            header = 'catch (__caught: any)'
            prelude = `    const ${generateDeclarationTarget(node.catchParam, true)} = __caught;\n`
          } else {
            header = `catch (${generateDeclarationTarget(node.catchParam)})`
          }
        }
        out += ` ${header} {\n${prelude}${stmts(node.catchBlock)}\n  }`
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

// `const a: A = 1, { b } = x` -- the declaration WITHOUT a trailing
// semicolon (used by statements and by C-style for headers). A null
// init (`let x`) emits just the target. Type annotations are emitted
// only in typed mode (the virtual .ts); real JS output omits them.
export function declarationSource(node, typed = false) {
  const one = (name, init, type) => {
    const target = generateDeclarationTarget(name, typed)
    const annotation = typed && type ? `: ${type}` : ''
    return init == null
      ? `${target}${annotation}`
      : `${target}${annotation} = ${generateExpression(init, typed)}`
  }
  const parts = [
    one(node.name, node.init, node.typeAnnotation),
    ...(node.more ?? []).map((m) => one(m.name, m.init, m.typeAnnotation)),
  ]
  return `${node.kind} ${parts.join(', ')}`
}

// The three parts of a C-style `for (init; test; update)` header.
export function forHeaderSource(node, typed = false) {
  const init = !node.init
    ? ''
    : node.init.type === 'VariableDeclaration'
      ? declarationSource(node.init, typed)
      : node.init.expressions.map((e) => generateExpression(e, typed)).join(', ')
  const test = node.test ? generateExpression(node.test, typed) : ''
  const update = (node.update ?? [])
    .map((e) => generateExpression(e, typed))
    .join(', ')
  return `${init}; ${test}; ${update}`
}

// Renders a binding target -- a plain identifier (the base case), or
// -- for destructuring -- a nested ObjectPattern/ArrayPattern, each
// with optional per-field renames, defaults, and a rest element,
// recursing through `binding` so patterns can nest arbitrarily deep
// (e.g. `const { data: { id, name } } = result`) instead of only
// supporting one flat level. Matches real JS destructuring syntax so
// the generated line is exactly what a hand-written `const { a } = x`
// would look like.
export function generateDeclarationTarget(target, typed = false) {
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