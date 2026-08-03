// generateTemplateExpression's twin, for the virtual .ts class body
// built in buildVirtualPageTs. The REAL compiled template (see
// codegen/generateTemplateExpression.js) prefixes state reads with
// "instance." because the render function receives the page instance
// as a separate closed-over parameter. Inside the virtual class,
// there is no separate "instance" -- state/props are literal class
// members -- so the equivalent prefix is "this.".
export function typedTemplateExpr(node, scope) {
  if (node.type === 'Identifier') {
    if (node.name === '$event' || scope.has(node.name)) return node.name
    return `this.${node.name}`
  }
  if (node.type === 'MemberExpression') {
    return node.computed
      ? `${typedTemplateExpr(node.object, scope)}[${typedTemplateExpr(node.property, scope)}]`
      : `${typedTemplateExpr(node.object, scope)}.${node.property}`
  }
  if (node.type === 'BinaryExpression') {
    return `(${typedTemplateExpr(node.left, scope)} ${node.operator} ${typedTemplateExpr(node.right, scope)})`
  }
  if (node.type === 'UnaryExpression') {
    return `(${node.operator}${typedTemplateExpr(node.argument, scope)})`
  }

  if (node.type === 'TernaryExpression') {
    return `(${typedTemplateExpr(node.condition, scope)} ? ${typedTemplateExpr(node.consequent, scope)} : ${typedTemplateExpr(node.alternate, scope)})`
  }

  if (node.type === 'NullishCoalescingExpression') {
    return `(${typedTemplateExpr(node.left, scope)} ?? ${typedTemplateExpr(node.right, scope)})`
  }

  if (node.type === 'AssignmentExpression') {
    return `${typedTemplateExpr(node.target, scope)} = ${typedTemplateExpr(node.value, scope)}`
  }
  if (node.type === 'CallExpression') {
    const args = node.args.map((a) => typedTemplateExpr(a, scope)).join(', ')
    return `${typedTemplateExpr(node.callee, scope)}(${args})`
  }
  if (node.type === 'NewExpression') {
    const args = node.args.map((a) => typedTemplateExpr(a, scope)).join(', ')
    return `new ${typedTemplateExpr(node.callee, scope)}(${args})`
  }
  if (node.type === 'Literal') {
    return typeof node.value === 'string'
      ? JSON.stringify(node.value)
      : String(node.value)
  }
  throw new Error(`typedTemplateExpr: unsupported node type "${node.type}"`)
}

const EVENT_ATTR_RE = /^on(click|input|change|submit)$/i

// Which DOM element type a synthetic $event's `target` should be
// typed as, keyed by the event name captured from EVENT_ATTR_RE
// (lowercased). Deliberately narrow -- these are the only event
// attributes the template grammar currently recognizes at all.
// Anything not listed falls back to the generic HTMLElement, same as
// a real framework would for an untyped/unknown handler.
const EVENT_TARGET_TYPES = {
  input: 'HTMLInputElement',
  change: 'HTMLInputElement',
  submit: 'HTMLFormElement',
  click: 'HTMLElement',
}

// Walks a parsed template AST (from parseTemplate) collecting every
// bindable expression as a tree of check entries, ready for
// buildVirtualPageTs to emit into a synthetic __render() method.
// Entries come in two kinds:
//   { kind: 'check', expr, line, eventType } -- a single expression
//     to typecheck (interpolation, #if condition, dynamic attribute)
//   { kind: 'each', itemName, iterableExpr, line, children } -- an
//     #each block; children is itself a list of these same entries
// The 'each' kind exists so the emitted TS can wrap its children in
// a real `for (const f of ...)` -- without an actual declaration for
// the loop variable, TS has no way to resolve identifiers like `f`
// inside the block, regardless of what our own scope-tracking says.
export function collectTemplateChecks(nodes, scope, out) {
  for (const node of nodes) {
    if (node.type === 'Interpolation') {
      out.push({
        kind: 'check',
        expr: typedTemplateExpr(node.expression, scope),
        line: node.line,
        eventType: null,
      })
    } else if (node.type === 'If') {
      out.push({
        kind: 'check',
        expr: typedTemplateExpr(node.condition, scope),
        line: node.line,
        eventType: null,
      })
      collectTemplateChecks(node.children, scope, out)
    } else if (node.type === 'Each') {
      const iterableExpr = typedTemplateExpr(node.iterable, scope)
      const children = []
      collectTemplateChecks(
        node.children,
        new Set([...scope, node.itemName]),
        children,
      )
      out.push({
        kind: 'each',
        itemName: node.itemName,
        iterableExpr,
        line: node.line,
        children,
      })
    } else if (node.type === 'Element') {
      for (const attr of node.attributes) {
        if (!attr.dynamic) continue
        const eventMatch = EVENT_ATTR_RE.exec(attr.name)
        const attrScope = eventMatch
          ? new Set([...scope, '$event', 'event'])
          : scope
        out.push({
          kind: 'check',
          expr: typedTemplateExpr(attr.value, attrScope),
          line: attr.line,
          eventType: eventMatch
            ? (EVENT_TARGET_TYPES[eventMatch[1].toLowerCase()] ?? 'HTMLElement')
            : null,
        })
      }
      collectTemplateChecks(node.children, scope, out)
    }
  }
}
