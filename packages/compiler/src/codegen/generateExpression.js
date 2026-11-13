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

// Renders an object/array literal used as a destructuring ASSIGNMENT
// target (`[a = 1, b] = arr`, `({ x, y = 2 } = obj)`). In a pattern, a
// default is `target = value` without the parentheses an ordinary
// assignment expression gets. `gen` renders ordinary expressions, so
// the script, template and virtual-.ts generators can all share this.
export function assignmentPatternSource(node, gen) {
  const pat = (n) => assignmentPatternSource(n, gen)
  if (node.type === 'ArrayExpression') {
    return `[${joinArrayElements(node.elements.map((e) => (e === null ? '' : pat(e))))}]`
  }
  if (node.type === 'ObjectExpression') {
    const parts = node.properties.map((p) => {
      if (p.spread) return `...${pat(p.value)}`
      if (p.method) {
        throw new Error('Methods are not allowed in a destructuring assignment target')
      }
      const keySrc = p.keyExpr ? `[${gen(p.keyExpr)}]` : JSON.stringify(p.key)
      return `${keySrc}: ${pat(p.value)}`
    })
    return `{ ${parts.join(', ')} }`
  }
  if (node.type === 'SpreadElement') return `...${pat(node.argument)}`
  if (node.type === 'AssignmentExpression') {
    return `${pat(node.target)} = ${gen(node.value)}`
  }
  return gen(node)
}

// Generic parameters and return type text for functions, virtual .ts
// only. Async functions are written with the INNER type (like
// methods), so it is wrapped in Promise<>; generators are left alone.
export function functionSignature(node, typed) {
  if (!typed) return { generics: '', ret: '' }
  const generics = node.typeParams ?? ''
  let ret = ''
  if (node.returnType && !node.isGenerator) {
    ret = `: ${node.isAsync ? `Promise<${node.returnType}>` : node.returnType}`
  }
  return { generics, ret }
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
      // Parameter-property modifiers stay for the checker; JS gets
      // explicit `this.x = x` assignments instead (classMemberSource).
      const mods =
        typed && p.isProperty
          ? `${p.accessibility ? `${p.accessibility} ` : ''}${p.isOverride ? 'override ' : ''}${p.isReadonly ? 'readonly ' : ''}`
          : ''
      return `${mods}${rest}${p.name}${type}${def}`
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

  // Modifiers: accessibility / override / readonly exist only in the
  // virtual .ts; real JS keeps just `static`.
  // Abstract members, `declare` fields and overload signatures carry no
  // runtime code; they exist only in the virtual .ts.
  const isSignature = m.kind !== 'field' && m.body == null
  if (!typed && (m.isAbstract || m.isDeclare || isSignature)) return null

  const stat = m.static ? 'static ' : ''
  const mods = typed
    ? `${m.isDeclare ? 'declare ' : ''}${m.accessibility ? `${m.accessibility} ` : ''}${stat}${m.isAbstract ? 'abstract ' : ''}${m.isOverride ? 'override ' : ''}${m.isReadonly ? 'readonly ' : ''}`
    : stat
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
      // TypeScript forbids `!` on static, abstract and declare fields.
      const definite = !m.value && !m.static && !m.isAbstract && !m.isDeclare
      annotation = definite ? `!: ${type}` : `: ${type}`
    }
    return `${mods}${keySrc}${annotation}${init};`
  }

  const generics = typed ? (m.typeParams ?? '') : ''
  const params = generateParams(m.params, typed)
  let ret = ''
  if (typed && m.returnType && !m.isGenerator) {
    ret = m.isAsync ? `: Promise<${m.returnType}>` : `: ${m.returnType}`
  }

  // Body-less (typed only, by the early return above): end with `;`.
  if (isSignature) {
    if (m.kind === 'constructor') return `constructor(${params});`
    if (m.kind === 'get') return `${mods}get ${keySrc}()${ret};`
    if (m.kind === 'set') return `${mods}set ${keySrc}(${params});`
    return `${mods}${m.isAsync ? 'async ' : ''}${m.isGenerator ? '*' : ''}${keySrc}${generics}(${params})${ret};`
  }

  const body = statementsInline(m.body, typed)
  if (m.kind === 'constructor') {
    return `constructor(${params}) { ${typed ? body : withParamProperties(m, body, typed)} }`
  }
  if (m.kind === 'get') return `${mods}get ${keySrc}()${ret} { ${body} }`
  if (m.kind === 'set') return `${mods}set ${keySrc}(${params}) { ${body} }`
  return `${mods}${m.isAsync ? 'async ' : ''}${m.isGenerator ? '*' : ''}${keySrc}${generics}(${params})${ret} { ${body} }`
}

// JS for `constructor(public x)`: assign `this.x = x` right after the
// top-level `super(...)` call when there is one (before it `this` is
// unusable), otherwise at the very start, matching TypeScript.
function withParamProperties(m, body, typed) {
  const props = m.params.filter((p) => p.isProperty)
  if (props.length === 0) return body
  const assigns = props.map((p) => `this.${p.name} = ${p.name};`).join(' ')
  const superIdx = m.body.findIndex(
    (s) =>
      s.type === 'ExpressionStatement' &&
      s.expression.type === 'CallExpression' &&
      s.expression.callee.type === 'Identifier' &&
      s.expression.callee.name === 'super',
  )
  if (superIdx === -1) return `${assigns} ${body}`
  const before = statementsInline(m.body.slice(0, superIdx + 1), typed)
  const after = statementsInline(m.body.slice(superIdx + 1), typed)
  return `${before} ${assigns} ${after}`
}

/**
 * Renders a ClassDeclaration / ClassExpression node. Statement form
 * has no trailing semicolon; the expression form wraps it in parens
 * in generateExpression. Generics, `implements` and member modifiers
 * are emitted only in typed mode.
 */
export function generateClass(node, typed = false) {
  const name = node.name ? ` ${node.name}` : ''
  const generics = typed ? (node.typeParams ?? '') : ''
  let ext = ''
  if (node.superClass) {
    const args = typed && node.superTypeArgs ? `<${node.superTypeArgs}>` : ''
    ext = ` extends ${generateExpression(node.superClass, typed)}${args}`
  }
  const impl = typed && node.implementsList ? ` implements ${node.implementsList}` : ''
  const members = node.members
    .map((m) => classMemberSource(m, typed))
    .filter((src) => src !== null)
    .map((src) => `    ${src}`)
  // JS classes often create fields in the constructor (`this.n = n`).
  // The index signature stops the checker from rejecting those, the
  // same way the page class does.
  if (typed) members.unshift('    [key: string]: any;')
  const abstract = typed && node.isAbstract ? 'abstract ' : ''
  return `${abstract}class${name}${generics}${ext}${impl} {\n${members.join('\n')}\n  }`
}

/**
 * Compiles a single expression AST node into a JS (or, when
 * typed=true, TypeScript) source string. Used both for method-body
 * statements/template interpolations (typed=false, real JS output)
 * and the virtual .ts file handed to the TypeScript compiler API
 * (typed=true) -- one source of truth for expression -> source
 * translation, so the two outputs can never structurally drift from
 * each other. `typed` only changes whether parameters get `: Type`
 * annotations and whether `as` / `!` / generics are kept. Everything
 * else emits identically either way.
 *
 * `await`, `yield` and assignment are always parenthesized:
 * `(await f()).x` and `ok && (count = count + 1)` are only valid JS
 * with the parens, and the extra pair is harmless at statement level.
 */
// An arrow / function expression used as an operand keeps its own
// parentheses: `a ?? (v => v)` must not come out as `a ?? (v) => v`,
// which is a syntax error.
const FUNCTION_NODES = new Set(['ArrowFunctionExpression', 'FunctionExpression'])
function operand(node, typed) {
  const src = generateExpression(node, typed)
  return FUNCTION_NODES.has(node?.type) ? `(${src})` : src
}

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
      return `(${operand(node.left, typed)} ?? ${operand(node.right, typed)})`

    case 'NewExpression': {
      const args = node.args.map((a) => generateExpression(a, typed)).join(', ')
      const typeArgs = typed && node.typeArgs ? `<${node.typeArgs}>` : ''
      return `new ${generateExpression(node.callee, typed)}${typeArgs}(${args})`
    }

    case 'BinaryExpression':
      return `(${operand(node.left, typed)} ${node.operator} ${operand(node.right, typed)})`

    case 'UnaryExpression':
      return `(${unaryPrefix(node.operator)}${operand(node.argument, typed)})`

    case 'UpdateExpression': {
      const arg = generateExpression(node.argument, typed)
      return node.prefix ? `(${node.operator}${arg})` : `(${arg}${node.operator})`
    }

    case 'TernaryExpression':
      return `(${operand(node.condition, typed)} ? ${generateExpression(node.consequent, typed)} : ${generateExpression(node.alternate, typed)})`

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
      const generics = typed ? (node.typeParams ?? '') : ''
      const returnType =
        typed && node.returnType ? `: ${node.returnType}` : ''

      // Block body: `x => { stmt stmt }`. Statements are emitted on
      // one line separated by spaces; multi-line statements (if,
      // for, try) keep their own newlines, which is still valid JS.
      if (node.body.type === 'BlockStatement') {
        return `${asyncPrefix}${generics}(${params})${returnType} => { ${statementsInline(node.body.body, typed)} }`
      }

      // Expression body is always parenthesized so an object literal
      // body (`x => ({ ...x })`) is never parsed as a block.
      return `${asyncPrefix}${generics}(${params})${returnType} => (${generateExpression(node.body, typed)})`
    }

    case 'FunctionExpression': {
      const { generics, ret } = functionSignature(node, typed)
      const asyncPrefix = node.isAsync ? 'async ' : ''
      const star = node.isGenerator ? '*' : ''
      const name = node.name ? ` ${node.name}` : ''
      return `(${asyncPrefix}function${star}${name}${generics}(${generateParams(node.params, typed)})${ret} { ${statementsInline(node.body, typed)} })`
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

    case 'AssignmentExpression': {
      const isPattern =
        node.target.type === 'ObjectExpression' ||
        node.target.type === 'ArrayExpression'
      const target = isPattern
        ? assignmentPatternSource(node.target, (n) => generateExpression(n, typed))
        : generateExpression(node.target, typed)
      return `(${target} = ${generateExpression(node.value, typed)})`
    }

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
      const typeArgs = typed && node.typeArgs ? `<${node.typeArgs}>` : ''
      return `${callee}${node.optional ? '?.' : ''}${typeArgs}(${args})`
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
          if (p.shorthandInit) {
            throw new Error(
              `"{ ${p.key} = ... }" is only valid as a destructuring assignment target, e.g. ({ ${p.key} = 1 } = obj)`,
            )
          }
          const keySrc = p.keyExpr
            ? `[${generateExpression(p.keyExpr, typed)}]`
            : JSON.stringify(p.key)
          if (p.method) {
            const f = p.value
            const body = statementsInline(f.body, typed)
            const params = generateParams(f.params, typed)
            const { generics, ret } = functionSignature(f, typed)
            if (p.kind === 'get') return `get ${keySrc}() { ${body} }`
            if (p.kind === 'set') return `set ${keySrc}(${params}) { ${body} }`
            return `${f.isAsync ? 'async ' : ''}${f.isGenerator ? '*' : ''}${keySrc}${generics}(${params})${ret} { ${body} }`
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