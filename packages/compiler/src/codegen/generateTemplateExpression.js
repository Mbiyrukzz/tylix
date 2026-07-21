import { generateExpression } from './generateExpression.js'

/**
 * Like generateExpression, but every Identifier is prefixed with
 * "instance." UNLESS it's a local name in `scope` (e.g. an
 * {{#each item in items}} loop variable), in which case it's left
 * bare -- it refers to the JS for-of loop variable, not a component
 * instance property.
 */
export function generateTemplateExpression(node, scope = new Set()) {
  if (node.type === 'Identifier') {
    // $event is the DOM event object passed into inline handlers,
    // not an instance property -- treat it like a loop variable and
    // leave it bare rather than prefixing with "instance.".
    if (node.name === '$event' || scope.has(node.name)) {
      return node.name
    }
    return `instance.${node.name}`
  }
  if (node.type === 'MemberExpression') {
    return node.computed
      ? `${generateTemplateExpression(node.object, scope)}[${generateTemplateExpression(node.property, scope)}]`
      : `${generateTemplateExpression(node.object, scope)}.${node.property}`
  }
  if (node.type === 'BinaryExpression') {
    return `(${generateTemplateExpression(node.left, scope)} ${node.operator} ${generateTemplateExpression(node.right, scope)})`
  }
  if (node.type === 'UnaryExpression') {
    return `(${node.operator}${generateTemplateExpression(node.argument, scope)})`
  }
  if (node.type === 'AssignmentExpression') {
    return `${generateTemplateExpression(node.target, scope)} = ${generateTemplateExpression(node.value, scope)}`
  }
  if (node.type === 'CallExpression') {
    const args = node.args
      .map((a) => generateTemplateExpression(a, scope))
      .join(', ')
    return `${generateTemplateExpression(node.callee, scope)}(${args})`
  }
  if (node.type === 'Literal') {
    return generateExpression(node)
  }
  throw new Error(
    `generateTemplateExpression: unsupported node type "${node.type}" in template expression`,
  )
}
