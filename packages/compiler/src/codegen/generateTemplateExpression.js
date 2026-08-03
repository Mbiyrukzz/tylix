import { generateExpression } from './generateExpression.js'

export function generateTemplateExpression(node, scope = new Set()) {
  if (node.type === 'Identifier') {
    if (node.name === '$event' || scope.has(node.name)) {
      return node.name
    }
    if (node.name === 'this') {
      return 'instance'
    }
    // "null", "true", "false", "undefined" are JS keywords, not
    // instance properties -- if the parser is tokenizing them as bare
    // Identifier nodes (rather than Literal nodes), they must NOT be
    // prefixed with "instance.", or comparisons like
    // `serverId is not null` silently compile to
    // `instance.serverId !== instance.null` (always undefined) instead
    // of `instance.serverId !== null`.
    if (
      node.name === 'null' ||
      node.name === 'true' ||
      node.name === 'false' ||
      node.name === 'undefined'
    ) {
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
  if (node.type === 'NewExpression') {
    const args = node.args
      .map((a) => generateTemplateExpression(a, scope))
      .join(', ')
    return `new ${generateTemplateExpression(node.callee, scope)}(${args})`
  }
  if (node.type === 'Literal') {
    return generateExpression(node)
  }
  throw new Error(
    `generateTemplateExpression: unsupported node type "${node.type}" in template expression`,
  )
}
