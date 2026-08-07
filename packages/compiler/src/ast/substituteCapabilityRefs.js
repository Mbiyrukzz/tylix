import { Identifier, MemberExpr } from './nodes.js'

function rewriteExpr(node, capabilityNames) {
  if (node == null) return node
  switch (node.type) {
    case 'Identifier':
      return capabilityNames.has(node.name)
        ? MemberExpr(Identifier('this'), node.name)
        : node
    case 'MemberExpression':
      return {
        ...node,
        object: rewriteExpr(node.object, capabilityNames),
        property: node.computed
          ? rewriteExpr(node.property, capabilityNames)
          : node.property,
      }
    case 'CallExpression':
      return {
        ...node,
        callee: rewriteExpr(node.callee, capabilityNames),
        args: node.args.map((a) => rewriteExpr(a, capabilityNames)),
      }
    case 'AssignmentExpression':
      return {
        ...node,
        target: rewriteExpr(node.target, capabilityNames),
        value: rewriteExpr(node.value, capabilityNames),
      }
    case 'BinaryExpression':
      return {
        ...node,
        left: rewriteExpr(node.left, capabilityNames),
        right: rewriteExpr(node.right, capabilityNames),
      }
    case 'UnaryExpression':
      return { ...node, argument: rewriteExpr(node.argument, capabilityNames) }
    case 'AwaitExpression':
      return { ...node, argument: rewriteExpr(node.argument, capabilityNames) }
    case 'TernaryExpression':
      return {
        ...node,
        condition: rewriteExpr(node.condition, capabilityNames),
        consequent: rewriteExpr(node.consequent, capabilityNames),
        alternate: rewriteExpr(node.alternate, capabilityNames),
      }
    case 'NullishCoalescingExpression':
      return {
        ...node,
        left: rewriteExpr(node.left, capabilityNames),
        right: rewriteExpr(node.right, capabilityNames),
      }
    case 'ArrowFunctionExpression':
      return { ...node, body: rewriteExpr(node.body, capabilityNames) }
    case 'ArrayExpression':
      return {
        ...node,
        elements: node.elements.map((e) => rewriteExpr(e, capabilityNames)),
      }
    case 'ObjectExpression':
      return {
        ...node,
        properties: node.properties.map((p) => ({
          ...p,
          value: rewriteExpr(p.value, capabilityNames),
        })),
      }
    default:
      return node
  }
}

function rewriteStatement(stmt, capabilityNames) {
  switch (stmt.type) {
    case 'ExpressionStatement':
      return {
        ...stmt,
        expression: rewriteExpr(stmt.expression, capabilityNames),
      }
    case 'ReturnStatement':
      return { ...stmt, argument: rewriteExpr(stmt.argument, capabilityNames) }
    case 'VariableDeclaration':
      return { ...stmt, init: rewriteExpr(stmt.init, capabilityNames) }
    case 'IfStatement':
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, capabilityNames),
        consequent: stmt.consequent.map((s) =>
          rewriteStatement(s, capabilityNames),
        ),
        alternate: stmt.alternate
          ? stmt.alternate.map((s) => rewriteStatement(s, capabilityNames))
          : null,
      }
    case 'ForInStatement':
      return {
        ...stmt,
        iterable: rewriteExpr(stmt.iterable, capabilityNames),
        body: stmt.body.map((s) => rewriteStatement(s, capabilityNames)),
      }
    case 'ForRangeStatement':
      return {
        ...stmt,
        start: rewriteExpr(stmt.start, capabilityNames),
        end: rewriteExpr(stmt.end, capabilityNames),
        body: stmt.body.map((s) => rewriteStatement(s, capabilityNames)),
      }
    case 'RepeatStatement':
      return {
        ...stmt,
        count: rewriteExpr(stmt.count, capabilityNames),
        body: stmt.body.map((s) => rewriteStatement(s, capabilityNames)),
      }
    case 'TryStatement':
      return {
        ...stmt,
        tryBlock: stmt.tryBlock.map((s) =>
          rewriteStatement(s, capabilityNames),
        ),
        catchBlock: stmt.catchBlock
          ? stmt.catchBlock.map((s) => rewriteStatement(s, capabilityNames))
          : null,
        finallyBlock: stmt.finallyBlock
          ? stmt.finallyBlock.map((s) => rewriteStatement(s, capabilityNames))
          : null,
      }
    case 'BreakStatement':
    case 'ContinueStatement':
      return stmt
    default:
      return stmt
  }
}

export function substituteCapabilityRefs(pageNode) {
  const capabilityNames = new Set([
    ...(pageNode.uses ?? []).map((u) => u.name),
    ...(pageNode.needs ?? []).map((n) => n.name),
    ...(pageNode.background ?? []).map((b) => b.name),
  ])
  if (capabilityNames.size === 0) return pageNode

  return {
    ...pageNode,
    computed: (pageNode.computed ?? []).map((c) => ({
      ...c,
      body: c.body.map((s) => rewriteStatement(s, capabilityNames)),
    })),
    actions: (pageNode.actions ?? []).map((a) => ({
      ...a,
      body: a.body.map((s) => rewriteStatement(s, capabilityNames)),
    })),
    onMount: pageNode.onMount
      ? {
          ...pageNode.onMount,
          body: pageNode.onMount.body.map((s) =>
            rewriteStatement(s, capabilityNames),
          ),
        }
      : null,
  }
}
