import { generateExpression } from './generateExpression.js'

// Plain JS globals that templates may use directly. Everything else
// that isn't a local (each variable, arrow param, $event) is treated
// as page state/capability and prefixed with "instance.".
const JS_GLOBALS = new Set([
  'null',
  'true',
  'false',
  'undefined',
  'NaN',
  'Infinity',
  'Math',
  'JSON',
  'Date',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'Set',
  'Map',
  'Intl',
  'Promise',
  'RegExp',
  'Symbol',
  'Error',
  'URL',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'console',
  'window',
])

function escapeTemplateLiteralText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
}

function unaryPrefix(operator) {
  return /^[a-z]/i.test(operator) ? `${operator} ` : operator
}

export function generateTemplateExpression(node, scope = new Set()) {
  if (node.type === 'Identifier') {
    if (node.name === '$event' || scope.has(node.name)) {
      return node.name
    }
    if (node.name === 'this') {
      return 'instance'
    }
    if (JS_GLOBALS.has(node.name)) {
      return node.name
    }
    return `instance.${node.name}`
  }

  if (node.type === 'MemberExpression') {
    if (node.computed) {
      return `${generateTemplateExpression(node.object, scope)}${node.optional ? '?.' : ''}[${generateTemplateExpression(node.property, scope)}]`
    }
    return `${generateTemplateExpression(node.object, scope)}${node.optional ? '?.' : '.'}${node.property}`
  }

  if (node.type === 'BinaryExpression') {
    return `(${generateTemplateExpression(node.left, scope)} ${node.operator} ${generateTemplateExpression(node.right, scope)})`
  }

  if (node.type === 'NullishCoalescingExpression') {
    return `(${generateTemplateExpression(node.left, scope)} ?? ${generateTemplateExpression(node.right, scope)})`
  }

  if (node.type === 'TernaryExpression') {
    return `(${generateTemplateExpression(node.condition, scope)} ? ${generateTemplateExpression(node.consequent, scope)} : ${generateTemplateExpression(node.alternate, scope)})`
  }

  if (node.type === 'UnaryExpression') {
    return `(${unaryPrefix(node.operator)}${generateTemplateExpression(node.argument, scope)})`
  }

  // Only valid inside an `async` arrow (`{{ async () => await ... }}`);
  // a bare `{{ await x }}` would land in a non-async render effect and
  // fail when the generated code is loaded.
  if (node.type === 'AwaitExpression') {
    return `(await ${generateTemplateExpression(node.argument, scope)})`
  }

  if (node.type === 'AssignmentExpression') {
    return `${generateTemplateExpression(node.target, scope)} = ${generateTemplateExpression(node.value, scope)}`
  }

  if (node.type === 'CallExpression') {
    const args = node.args
      .map((a) => generateTemplateExpression(a, scope))
      .join(', ')
    return `${generateTemplateExpression(node.callee, scope)}${node.optional ? '?.' : ''}(${args})`
  }

  if (node.type === 'NewExpression') {
    const args = node.args
      .map((a) => generateTemplateExpression(a, scope))
      .join(', ')
    return `new ${generateTemplateExpression(node.callee, scope)}(${args})`
  }

  // (a, b) => expr -- params become locals for the body, so they are
  // referenced bare instead of being prefixed with "instance.". The
  // whole function is parenthesized so it is safe both as a call
  // argument and as an event handler that gets invoked immediately.
  if (node.type === 'ArrowFunctionExpression') {
    const innerScope = new Set([...scope, ...node.params])
    const params = node.params.join(', ')
    const body = generateTemplateExpression(node.body, innerScope)
    const asyncPrefix = node.isAsync ? 'async ' : ''
    return `(${asyncPrefix}(${params}) => ${body})`
  }

  if (node.type === 'ArrayExpression') {
    const elements = node.elements
      .map((e) => generateTemplateExpression(e, scope))
      .join(', ')
    return `[${elements}]`
  }

  // Parenthesized so an object literal is never mistaken for a block
  // when it ends up as an arrow function body: x => ({ ... })
  if (node.type === 'ObjectExpression') {
    const properties = node.properties
      .map((p) =>
        p.spread
          ? `...${generateTemplateExpression(p.value, scope)}`
          : `${JSON.stringify(p.key)}: ${generateTemplateExpression(p.value, scope)}`,
      )
      .join(', ')
    return `({ ${properties} })`
  }

  if (node.type === 'SpreadElement') {
    return `...${generateTemplateExpression(node.argument, scope)}`
  }

  if (node.type === 'TemplateLiteralExpression') {
    const body = node.parts
      .map((part) =>
        part.type === 'text'
          ? escapeTemplateLiteralText(part.value)
          : `\${${generateTemplateExpression(part.expression, scope)}}`,
      )
      .join('')
    return `\`${body}\``
  }

  if (node.type === 'Literal') {
    return generateExpression(node)
  }

  throw new Error(
    `generateTemplateExpression: unsupported node type "${node.type}" in template expression`,
  )
}