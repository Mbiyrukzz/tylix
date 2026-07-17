/**
 * Compiles a single expression AST node into a JS source string.
 * Used both for method-body statements and template interpolations,
 * so every consumer (class codegen, template codegen) shares one
 * source of truth for expression -> JS translation.
 */
export function generateExpression(node) {
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string'
        ? JSON.stringify(node.value)
        : String(node.value)

    case 'Identifier':
      return node.name

    case 'MemberExpression':
      return `${generateExpression(node.object)}.${node.property}`

    case 'BinaryExpression':
      return `(${generateExpression(node.left)} ${node.operator} ${generateExpression(node.right)})`

    case 'UnaryExpression':
      return `(${node.operator}${generateExpression(node.argument)})`

    case 'TernaryExpression':
      return `(${generateExpression(node.condition)} ? ${generateExpression(node.consequent)} : ${generateExpression(node.alternate)})`

    case 'ArrowFunctionExpression': {
      const params = node.params.join(', ')
      return `(${params}) => (${generateExpression(node.body)})`
    }

    case 'TemplateLiteralExpression': {
      const inner = node.parts
        .map((p) =>
          p.type === 'text'
            ? escapeTemplateText(p.value)
            : `\${${generateExpression(p.expression)}}`,
        )
        .join('')
      return `\`${inner}\``
    }

    case 'AssignmentExpression':
      return `${generateExpression(node.target)} = ${generateExpression(node.value)}`

    case 'CallExpression': {
      const args = node.args.map((a) => generateExpression(a)).join(', ')
      return `${generateExpression(node.callee)}(${args})`
    }

    case 'AwaitExpression':
      return `await ${generateExpression(node.argument)}`

    case 'ObjectExpression': {
      const props = node.properties
        .map((p) => `${JSON.stringify(p.key)}: ${generateExpression(p.value)}`)
        .join(', ')
      return `{ ${props} }`
    }

    case 'ArrayExpression': {
      const elements = node.elements
        .map((e) => generateExpression(e))
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
