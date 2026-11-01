import { Identifier, MemberExpr } from './nodes.js'

function rewriteList(list, names) {
  return list.map((s) => rewriteStatement(s, names))
}

function rewriteParams(params, names) {
  return params.map((p) =>
    p.defaultValue
      ? { ...p, defaultValue: rewriteExpr(p.defaultValue, names) }
      : p,
  )
}

function rewriteExpr(node, names) {
  if (node == null) return node
  switch (node.type) {
    case 'Identifier':
      return names.has(node.name)
        ? MemberExpr(Identifier('this'), node.name)
        : node
    case 'MemberExpression':
      return {
        ...node,
        object: rewriteExpr(node.object, names),
        property: node.computed
          ? rewriteExpr(node.property, names)
          : node.property,
      }
    case 'CallExpression':
    case 'NewExpression':
      return {
        ...node,
        callee: rewriteExpr(node.callee, names),
        args: node.args.map((a) => rewriteExpr(a, names)),
      }
    case 'AssignmentExpression':
      return {
        ...node,
        target: rewriteExpr(node.target, names),
        value: rewriteExpr(node.value, names),
      }
    case 'BinaryExpression':
    case 'NullishCoalescingExpression':
      return {
        ...node,
        left: rewriteExpr(node.left, names),
        right: rewriteExpr(node.right, names),
      }
    case 'UnaryExpression':
    case 'AwaitExpression':
    case 'SpreadElement':
      return { ...node, argument: rewriteExpr(node.argument, names) }
    case 'TernaryExpression':
      return {
        ...node,
        condition: rewriteExpr(node.condition, names),
        consequent: rewriteExpr(node.consequent, names),
        alternate: rewriteExpr(node.alternate, names),
      }
    case 'ArrowFunctionExpression':
      // body is an expression or a BlockStatement
      return {
        ...node,
        body: rewriteExpr(node.body, names),
        paramDefaults: node.paramDefaults
          ? node.paramDefaults.map((d) => rewriteExpr(d, names))
          : node.paramDefaults,
      }
    case 'FunctionExpression':
      return {
        ...node,
        params: rewriteParams(node.params, names),
        body: rewriteList(node.body, names),
      }
    case 'BlockStatement':
      return { ...node, body: rewriteList(node.body, names) }
    case 'ArrayExpression':
      return {
        ...node,
        elements: node.elements.map((e) => rewriteExpr(e, names)),
      }
    case 'ObjectExpression':
      return {
        ...node,
        properties: node.properties.map((p) => ({
          ...p,
          keyExpr: p.keyExpr ? rewriteExpr(p.keyExpr, names) : p.keyExpr,
          value: rewriteExpr(p.value, names),
        })),
      }
    case 'TemplateLiteralExpression':
      return {
        ...node,
        parts: node.parts.map((p) =>
          p.type === 'expr'
            ? { ...p, expression: rewriteExpr(p.expression, names) }
            : p,
        ),
      }
    default:
      return node
  }
}

function rewriteDeclaration(stmt, names) {
  return {
    ...stmt,
    init: rewriteExpr(stmt.init, names),
    more: (stmt.more ?? []).map((m) => ({
      ...m,
      init: rewriteExpr(m.init, names),
    })),
  }
}

function rewriteStatement(stmt, names) {
  switch (stmt.type) {
    case 'ExpressionStatement':
      return { ...stmt, expression: rewriteExpr(stmt.expression, names) }
    case 'ReturnStatement':
    case 'ThrowStatement':
      return { ...stmt, argument: rewriteExpr(stmt.argument, names) }
    case 'VariableDeclaration':
      return rewriteDeclaration(stmt, names)
    case 'FunctionDeclaration':
      return {
        ...stmt,
        params: rewriteParams(stmt.params, names),
        body: rewriteList(stmt.body, names),
      }
    case 'IfStatement':
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, names),
        consequent: rewriteList(stmt.consequent, names),
        alternate: stmt.alternate ? rewriteList(stmt.alternate, names) : null,
      }
    case 'WhileStatement':
    case 'DoWhileStatement':
      return {
        ...stmt,
        condition: rewriteExpr(stmt.condition, names),
        body: rewriteList(stmt.body, names),
      }
    case 'SwitchStatement':
      return {
        ...stmt,
        discriminant: rewriteExpr(stmt.discriminant, names),
        cases: stmt.cases.map((c) => ({
          tests: c.tests ? c.tests.map((t) => rewriteExpr(t, names)) : null,
          body: rewriteList(c.body, names),
        })),
      }
    case 'ForInStatement':
      return {
        ...stmt,
        iterable: rewriteExpr(stmt.iterable, names),
        body: rewriteList(stmt.body, names),
      }
    case 'ForKeysStatement':
      return {
        ...stmt,
        object: rewriteExpr(stmt.object, names),
        body: rewriteList(stmt.body, names),
      }
    case 'ForStatement': {
      let init = stmt.init
      if (init && init.type === 'VariableDeclaration') {
        init = rewriteDeclaration(init, names)
      } else if (init && init.type === 'ExpressionList') {
        init = {
          ...init,
          expressions: init.expressions.map((e) => rewriteExpr(e, names)),
        }
      }
      return {
        ...stmt,
        init,
        test: rewriteExpr(stmt.test, names),
        update: (stmt.update ?? []).map((e) => rewriteExpr(e, names)),
        body: rewriteList(stmt.body, names),
      }
    }
    case 'ForRangeStatement':
      return {
        ...stmt,
        start: rewriteExpr(stmt.start, names),
        end: rewriteExpr(stmt.end, names),
        body: rewriteList(stmt.body, names),
      }
    case 'RepeatStatement':
      return {
        ...stmt,
        count: rewriteExpr(stmt.count, names),
        body: rewriteList(stmt.body, names),
      }
    case 'TryStatement':
      return {
        ...stmt,
        tryBlock: rewriteList(stmt.tryBlock, names),
        catchBlock: stmt.catchBlock ? rewriteList(stmt.catchBlock, names) : null,
        finallyBlock: stmt.finallyBlock
          ? rewriteList(stmt.finallyBlock, names)
          : null,
      }
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
      params: rewriteParams(c.params ?? [], capabilityNames),
      body: rewriteList(c.body, capabilityNames),
    })),
    actions: (pageNode.actions ?? []).map((a) => ({
      ...a,
      params: rewriteParams(a.params ?? [], capabilityNames),
      body: rewriteList(a.body, capabilityNames),
    })),
    onMount: pageNode.onMount
      ? {
          ...pageNode.onMount,
          body: rewriteList(pageNode.onMount.body, capabilityNames),
        }
      : null,
  }
}