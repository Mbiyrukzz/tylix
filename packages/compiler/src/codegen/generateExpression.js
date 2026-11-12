import { generateStatement } from './generateStatement.js'

// Note: generateStatement.js imports generateExpression and this file
// imports generateStatement (block-bodied arrows, function expressions
// and class bodies need it). That circular import is safe in ES
// modules because both are hoisted function declarations only called
// at runtime, never at load time.

// Word operators (typeof, delete, void) need a space before their
// operand; symbolic ones (!, ~, -, +) must not get one.
function unaryPrefix(operator) {
  return /^[a-z]/i.test(operator) ? `${operator} ` : operator
}

// Joins array-literal element sources. A hole is an empty string, and
// a trailing hole needs one extra comma to keep the array's length
// (`[1, ,]` has length 2).
export function joinArrayElements(parts) {
  const joined = parts.join(', ')
  return parts.length > 0 && parts[parts.length - 1] === ''
    ? `${joined},`
    : joined
}

// `5.toFixed(1)` is a syntax error; `(5).toFixed(1)` is not.
function memberObjectSource(node, typed) {
  const src = generateExpression(node, typed)
  return node.type === 'Literal' && typeof node.value === 'number'
    ? `(${src})`
    : src
}

/**
 * Renders a parameter list: [{ name, typeAnnotation, defaultValue,
 * rest, optional }]. `typed` adds `: Type` annotations (falling back
 * to `any`, or `any[]` for rest params) and `?` for optional params
 * for the virtual .ts file; real JS output omits them. An optional
 * param with a default gets no `?` (TypeScript forbids both).
 */
export function generateParams(params, typed = false) {
  return params
    .map((p) => {
      const rest = p.rest ? '...' : ''
      const optional = typed && p.optional && !p.defaultValue ? '?' : ''
      const type = typed
        ? `${optional}: ${p.typeAnnotation ?? (p.rest ? 'any[]' : 'any')}`
        : ''
      const def = p.defaultValue
        ? ` = ${generateExpression(p.defaultValue, typed)}`
        : ''
      return `${rest}${p.name}${type}${def}`
    })
    .join(', ')
}

function statementsInline(body, typed) {
  return body.map((s) => generateStatement(s, typed)).join(' ')
}

function classMemberSource(m, typed) {
  if (m.kind === 'staticBlock') {
    return `static { ${statementsInline(m.body, typed)} }`
  }

  const stat = m.static ? 'static ' : ''
  const keySrc =
    m.keyKind === 'computed'
      ? `[${generateExpression(m.keyExpr, typed)}]`
      : m.keyKind === 'string'
        ? JSON.stringify(m.key)
        : m.key // plain names (including #private) and number keys

  if (m.kind === 'field') {
    const init = m.value ? ` = ${generateExpression(m.value, typed)}` : ''
    let annotation = ''
    if (typed) {
      const type = m.typeAnnotation ?? 'any'
      // An instance field with no initializer needs `!` under strict;
      // TypeScript forbids `!` on static fields.
      annotation = !m.value && !m.static ? `!: ${type}` : `: ${type}`
    }
    return `${stat}${keySrc}${annotation}${init};`
  }

  const params = generateParams(m.params, typed)
  const body = statementsInline(m.body, typed)
  let ret = ''
  if (typed && m.returnType && !m.isGenerator) {
    ret = m.isAsync ? `: Promise<${m.returnType}>` : `: ${m.returnType}`
  }

  if (m.kind === 'constructor') return `constructor(${params}) { ${body} }`
  if (m.kind === 'get') return `${stat}get ${keySrc}()${ret} { ${body} }`
  if (m.kind === 'set') return `${stat}set ${keySrc}(${params}) { ${body} }`
  return `${stat}${m.isAsync ? 'async ' : ''}${m.isGenerator ? '*' : ''}${keySrc}(${params})${ret} { ${body} }`
}

/**
 * Renders a ClassDeclaration / ClassExpression node. Statement form
 * has no trailing semicolon; the expression form wraps it in parens
 * in generateExpression.
 */
export function generateClass(node, typed = false) {
  const name = node.name ? ` ${node.name}` : ''
  const ext = node.superClass
    ? ` extends ${generateExpression(node.superClass, typed)}`
    : ''
  const members = node.members.map((m) => `    ${classMemberSource(m, typed)}`)
  return `class${name}${ext} {\n${members.join('\n')}\n  }`
}

/**
 * Compiles a single expression AST node into a JS (or, when
 * typed=true, TypeScript) source string. Used both for method-body
 * statements/template interpolations (typed=false, real JS output)
 * and the virtual .ts file handed to the TypeScript compiler API
 * (typed=true) -- one source of truth for expression -> source
 * translation, so the two outputs can never structurally drift from
 * each other. `typed` only changes whether parameters get `: Type`
 * annotations and whether `as` / `!` are kept. Everything else emits
 * identically either way.
 *
 * `await`, `yield` and assignment are always parenthesized:
 * `(await f()).x` and `ok && (count = count + 1)` are only valid JS
 * with the parens, and the extra pair is harmless at statement level.
 */
export function generateExpression(node, typed = false) {
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string'
        ? JSON.stringify(node.value)
        : String(node.value)

    case 'Identifier':
      return node.name

    case 'MemberExpression':
      if (node.computed) {
        return `${memberObjectSource(node.object, typed)}${node.optional ? '?.' : ''}[${generateExpression(node.property, typed)}]`
      }
      return `${memberObjectSource(node.object, typed)}${node.optional ? '?.' : '.'}${node.property}`

    case 'NullishCoalescingExpression':
      return `(${generateExpression(node.left, typed)} ?? ${generateExpression(node.right, typed)})`

    case 'NewExpression': {
      const args = node.args.map((a) => generateExpression(a, typed)).join(', ')
      return `new ${generateExpression(node.callee, typed)}(${args})`
    }

    case 'BinaryExpression':
      return `(${generateExpression(node.left, typed)} ${node.operator} ${generateExpression(node.right, typed)})`

    case 'UnaryExpression':
      return `(${unaryPrefix(node.operator)}${generateExpression(node.argument, typed)})`

    case 'TernaryExpression':
      return `(${generateExpression(node.condition, typed)} ? ${generateExpression(node.consequent, typed)} : ${generateExpression(node.alternate, typed)})`

    // `(a, b, c)` -- the comma operator.
    case 'SequenceExpression':
      return `(${node.expressions.map((e) => generateExpression(e, typed)).join(', ')})`

    // `x as T`, `x satisfies T` and `x!` exist only for the
    // TypeScript checker; in real JS output they reduce to the inner
    // expression.
    case 'AsExpression':
      return typed
        ? `(${generateExpression(node.expression, typed)} ${node.keyword ?? 'as'} ${node.typeAnnotation})`
        : generateExpression(node.expression, typed)

    case 'NonNullExpression':
      return typed
        ? `${generateExpression(node.expression, typed)}!`
        : generateExpression(node.expression, typed)

    case 'ArrowFunctionExpression': {
      // paramTypes is a parallel array of type strings or null,
      // populated by tryParseSyncArrow when a dev writes
      // `f: Post => ...`; absent/null entries mean "no annotation
      // was written" -- in typed mode those fall back to `any`
      // (`any[]` for a rest param) rather than being left bare,
      // since a bare untyped param in a .ts arrow function has no
      // implicit-any exemption the way real JS does. paramDefaults and
      // paramOptional are parallel arrays too (expression or null,
      // boolean).
      const paramTypes = node.paramTypes ?? node.params.map(() => null)
      const paramDefaults = node.paramDefaults ?? node.params.map(() => null)
      const paramOptional = node.paramOptional ?? node.params.map(() => false)
      const params = node.params
        .map((name, i) => {
          let out = name
          if (typed) {
            const fallback = name.startsWith('...') ? 'any[]' : 'any'
            const optional = paramOptional[i] && !paramDefaults[i] ? '?' : ''
            out = `${name}${optional}: ${paramTypes[i] ?? fallback}`
          }
          if (paramDefaults[i]) {
            out += ` = ${generateExpression(paramDefaults[i], typed)}`
          }
          return out
        })
        .join(', ')
      const asyncPrefix = node.isAsync ? 'async ' : ''
      const returnType =
        typed && node.returnType ? `: ${node.returnType}` : ''

      // Block body: `x => { stmt stmt }`. Statements are emitted on
      // one line separated by spaces; multi-line statements (if,
      // for, try) keep their own newlines, which is still valid JS.
      if (node.body.type === 'BlockStatement') {
        return `${asyncPrefix}(${params})${returnType} => { ${statementsInline(node.body.body, typed)} }`
      }

      // Expression body is always parenthesized so an object literal
      // body (`x => ({ ...x })`) is never parsed as a block.
      return `${asyncPrefix}(${params})${returnType} => (${generateExpression(node.body, typed)})`
    }

    case 'FunctionExpression': {
      const asyncPrefix = node.isAsync ? 'async ' : ''
      const star = node.isGenerator ? '*' : ''
      const name = node.name ? ` ${node.name}` : ''
      return `(${asyncPrefix}function${star}${name}(${generateParams(node.params, typed)}) { ${statementsInline(node.body, typed)} })`
    }

    case 'ClassExpression':
      return `(${generateClass(node, typed)})`

    case 'YieldExpression': {
      const star = node.delegate ? '*' : ''
      const arg = node.argument ? ` ${generateExpression(node.argument, typed)}` : ''
      return `(yield${star}${arg})`
    }

    case 'TemplateLiteralExpression': {
      const inner = node.parts
        .map((p) =>
          p.type === 'text'
            ? escapeTemplateText(p.value)
            : `\${${generateExpression(p.expression, typed)}}`,
        )
        .join('')
      return `\`${inner}\``
    }

    // tag`text ${x}`: text parts are emitted exactly as written
    // (`raw`), so String.raw and custom tags see the original escapes.
    case 'TaggedTemplateExpression': {
      const inner = node.quasi.parts
        .map((p) =>
          p.type === 'text'
            ? (p.raw ?? escapeTemplateText(p.value))
            : `\${${generateExpression(p.expression, typed)}}`,
        )
        .join('')
      return `${generateExpression(node.tag, typed)}\`${inner}\``
    }

    case 'AssignmentExpression':
      return `(${generateExpression(node.target, typed)} = ${generateExpression(node.value, typed)})`

    case 'CallExpression': {
      const args = node.args
        .map((a) => generateExpression(a, typed))
        .join(', ')
      let callee = generateExpression(node.callee, typed)
      // An arrow is not parenthesized on its own, and
      // `(x) => (y)(args)` would call the body, not the arrow. (The
      // `has` operator produces exactly this shape.)
      if (node.callee.type === 'ArrowFunctionExpression') {
        callee = `(${callee})`
      }
      return `${callee}${node.optional ? '?.' : ''}(${args})`
    }

    case 'AwaitExpression':
      return `(await ${generateExpression(node.argument, typed)})`

    case 'SpreadElement':
      return `...${generateExpression(node.argument, typed)}`

    case 'ObjectExpression': {
      // Spread entries have key === null and spread === true (see
      // Parser.parseObjectLiteral), so check p.spread before p.key.
      // Computed keys carry keyExpr; method shorthand and accessors
      // carry method === true with a FunctionExpression value and a
      // kind of 'method' | 'get' | 'set'.
      const props = node.properties
        .map((p) => {
          if (p.spread) return `...${generateExpression(p.value, typed)}`
          const keySrc = p.keyExpr
            ? `[${generateExpression(p.keyExpr, typed)}]`
            : JSON.stringify(p.key)
          if (p.method) {
            const f = p.value
            const body = statementsInline(f.body, typed)
            const params = generateParams(f.params, typed)
            if (p.kind === 'get') return `get ${keySrc}() { ${body} }`
            if (p.kind === 'set') return `set ${keySrc}(${params}) { ${body} }`
            return `${f.isAsync ? 'async ' : ''}${f.isGenerator ? '*' : ''}${keySrc}(${params}) { ${body} }`
          }
          return `${keySrc}: ${generateExpression(p.value, typed)}`
        })
        .join(', ')
      return `{ ${props} }`
    }

    // Holes (`null` elements) become empty slots: [1, , 3]
    case 'ArrayExpression': {
      const parts = node.elements.map((e) =>
        e === null ? '' : generateExpression(e, typed),
      )
      return `[${joinArrayElements(parts)}]`
    }

    default:
      throw new Error(`generateExpression: unknown node type "${node.type}"`)
  }
}

// Escapes characters that would otherwise break out of the generated
// JS template literal's own backtick delimiters -- backslashes,
// literal backticks, and literal "${" sequences appearing in static
// text parts (as opposed to real interpolations, which are already
// handled separately above).
function escapeTemplateText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
}