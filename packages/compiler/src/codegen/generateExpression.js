import { generateStatement } from './generateStatement.js'

// Note: generateStatement.js imports generateExpression and this file
// imports generateStatement (block-bodied arrows need it). That
// circular import is safe in ES modules because both are hoisted
// function declarations only called at runtime, never at load time.

// Word operators (typeof) need a space before their operand;
// symbolic ones (!, -) must not get one.
function unaryPrefix(operator) {
  return /^[a-z]/i.test(operator) ? `${operator} ` : operator
}

/**
 * Compiles a single expression AST node into a JS (or, when
 * typed=true, TypeScript) source string. Used both for method-body
 * statements/template interpolations (typed=false, real JS output)
 * and the virtual .ts file handed to the TypeScript compiler API
 * (typed=true) -- one source of truth for expression -> source
 * translation, so the two outputs can never structurally drift from
 * each other. `typed` only changes ONE thing: whether an arrow
 * function's params get a `: Type` annotation. Everything else emits
 * identically either way.
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
        return `${generateExpression(node.object, typed)}${node.optional ? '?.' : ''}[${generateExpression(node.property, typed)}]`
      }
      return `${generateExpression(node.object, typed)}${node.optional ? '?.' : '.'}${node.property}`

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

    case 'ArrowFunctionExpression': {
      // paramTypes is a parallel array of type strings or null,
      // populated by tryParseArrowFunction when a dev writes
      // `f: Post => ...`; absent/null entries mean "no annotation
      // was written" -- in typed mode those fall back to `any`
      // rather than being left bare, since a bare untyped param in a
      // .ts arrow function has no implicit-any exemption the way
      // real JS does.
      const paramTypes = node.paramTypes ?? node.params.map(() => null)
      const params = node.params
        .map((name, i) => {
          if (!typed) return name
          const paramType = paramTypes[i]
          return `${name}: ${paramType ?? 'any'}`
        })
        .join(', ')
      const asyncPrefix = node.isAsync ? 'async ' : ''

      // Block body: `x => { stmt stmt }`. Statements are emitted on
      // one line separated by spaces; multi-line statements (if,
      // for, try) keep their own newlines, which is still valid JS.
      if (node.body.type === 'BlockStatement') {
        const stmts = node.body.body
          .map((s) => generateStatement(s, typed))
          .join(' ')
        return `${asyncPrefix}(${params}) => { ${stmts} }`
      }

      // Expression body is always parenthesized so an object literal
      // body (`x => ({ ...x })`) is never parsed as a block.
      return `${asyncPrefix}(${params}) => (${generateExpression(node.body, typed)})`
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

    case 'AssignmentExpression':
      return `${generateExpression(node.target, typed)} = ${generateExpression(node.value, typed)}`

    case 'CallExpression': {
      const args = node.args
        .map((a) => generateExpression(a, typed))
        .join(', ')
      return `${generateExpression(node.callee, typed)}${node.optional ? '?.' : ''}(${args})`
    }

    case 'AwaitExpression':
      return `await ${generateExpression(node.argument, typed)}`

    case 'SpreadElement':
      return `...${generateExpression(node.argument, typed)}`

    case 'ObjectExpression': {
      // Spread entries have key === null and spread === true (see
      // Parser.parseObjectLiteral), so check p.spread before p.key.
      const props = node.properties
        .map((p) =>
          p.spread
            ? `...${generateExpression(p.value, typed)}`
            : `${JSON.stringify(p.key)}: ${generateExpression(p.value, typed)}`,
        )
        .join(', ')
      return `{ ${props} }`
    }

    case 'ArrayExpression': {
      const elements = node.elements
        .map((e) => generateExpression(e, typed))
        .join(', ')
      return `[${elements}]`
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