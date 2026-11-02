import { JS_GLOBALS, paramNames } from '../codegen/jsGlobals.js'

// generateTemplateExpression's twin, for the virtual .ts class body
// built in buildVirtualPageTs. The REAL compiled template (see
// codegen/generateTemplateExpression.js) prefixes state reads with
// "instance." because the render function receives the page instance
// as a separate closed-over parameter. Inside the virtual class,
// there is no separate "instance" -- state/props are literal class
// members -- so the equivalent prefix is "this.".

function escapeTemplateText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
}

function unaryPrefix(operator) {
  return /^[a-z]/i.test(operator) ? `${operator} ` : operator
}

export function typedTemplateExpr(node, scope) {
  if (node.type === 'Identifier') {
    if (node.name === '$event' || scope.has(node.name)) return node.name
    if (node.name === 'this') return 'this'
    if (JS_GLOBALS.has(node.name)) return node.name
    return `this.${node.name}`
  }
  if (node.type === 'MemberExpression') {
    if (node.computed) {
      return `${typedTemplateExpr(node.object, scope)}${node.optional ? '?.' : ''}[${typedTemplateExpr(node.property, scope)}]`
    }
    return `${typedTemplateExpr(node.object, scope)}${node.optional ? '?.' : '.'}${node.property}`
  }
  if (node.type === 'BinaryExpression') {
    return `(${typedTemplateExpr(node.left, scope)} ${node.operator} ${typedTemplateExpr(node.right, scope)})`
  }
  if (node.type === 'UnaryExpression') {
    return `(${unaryPrefix(node.operator)}${typedTemplateExpr(node.argument, scope)})`
  }

  if (node.type === 'AwaitExpression') {
    return `(await ${typedTemplateExpr(node.argument, scope)})`
  }

  if (node.type === 'TernaryExpression') {
    return `(${typedTemplateExpr(node.condition, scope)} ? ${typedTemplateExpr(node.consequent, scope)} : ${typedTemplateExpr(node.alternate, scope)})`
  }

  if (node.type === 'NullishCoalescingExpression') {
    return `(${typedTemplateExpr(node.left, scope)} ?? ${typedTemplateExpr(node.right, scope)})`
  }

 if (node.type === 'AssignmentExpression') {
  return `(${typedTemplateExpr(node.target, scope)} = ${typedTemplateExpr(node.value, scope)})`
}
  if (node.type === 'CallExpression') {
    const args = node.args.map((a) => typedTemplateExpr(a, scope)).join(', ')
    return `${typedTemplateExpr(node.callee, scope)}${node.optional ? '?.' : ''}(${args})`
  }
  if (node.type === 'NewExpression') {
    const args = node.args.map((a) => typedTemplateExpr(a, scope)).join(', ')
    return `new ${typedTemplateExpr(node.callee, scope)}(${args})`
  }

  // Arrow params are typed `any` unless annotated, matching what
  // generateExpression does in typed mode. Params become locals, so
  // they are referenced bare in the body. Destructured/rest params are
  // stored as source strings; paramNames() extracts the names they
  // bind. Defaults are checked in the arrow's own scope.
  if (node.type === 'ArrowFunctionExpression') {
    const innerScope = new Set([...scope, ...paramNames(node.params)])
    const types = node.paramTypes ?? node.params.map(() => null)
    const defaults = node.paramDefaults ?? []
    const params = node.params
      .map((name, i) => {
        const base = `${name}: ${types[i] ?? 'any'}`
        return defaults[i]
          ? `${base} = ${typedTemplateExpr(defaults[i], innerScope)}`
          : base
      })
      .join(', ')
    const asyncPrefix = node.isAsync ? 'async ' : ''
    return `(${asyncPrefix}(${params}) => (${typedTemplateExpr(node.body, innerScope)}))`
  }

  if (node.type === 'ArrayExpression') {
    const elements = node.elements
      .map((e) => typedTemplateExpr(e, scope))
      .join(', ')
    return `[${elements}]`
  }

  if (node.type === 'ObjectExpression') {
    const properties = node.properties
      .map((p) => {
        if (p.spread) return `...${typedTemplateExpr(p.value, scope)}`
        if (p.method) {
          throw new Error(
            'Method shorthand ({ fn() {} }) is only allowed in script code, not in template expressions',
          )
        }
        const keySrc = p.keyExpr
          ? `[${typedTemplateExpr(p.keyExpr, scope)}]`
          : JSON.stringify(p.key)
        return `${keySrc}: ${typedTemplateExpr(p.value, scope)}`
      })
      .join(', ')
    return `({ ${properties} })`
  }

  if (node.type === 'SpreadElement') {
    return `...${typedTemplateExpr(node.argument, scope)}`
  }

  if (node.type === 'TemplateLiteralExpression') {
    const body = node.parts
      .map((part) =>
        part.type === 'text'
          ? escapeTemplateText(part.value)
          : `\${${typedTemplateExpr(part.expression, scope)}}`,
      )
      .join('')
    return `\`${body}\``
  }

  if (node.type === 'Literal') {
    return typeof node.value === 'string'
      ? JSON.stringify(node.value)
      : String(node.value)
  }
  throw new Error(`typedTemplateExpr: unsupported node type "${node.type}"`)
}

// Any on<event> attribute is an event listener (see generateTemplate).
const EVENT_ATTR_RE = /^on([a-z]+)$/i

// [event interface, element type of `event.target`] per DOM event
// name. Anything not listed falls back to a plain Event on a generic
// HTMLElement, same as a real framework would for an unknown handler.
const MOUSE = ['MouseEvent', 'HTMLElement']
const KEY = ['KeyboardEvent', 'HTMLInputElement']
const FOCUS = ['FocusEvent', 'HTMLInputElement']
const POINTER = ['PointerEvent', 'HTMLElement']
const DRAG = ['DragEvent', 'HTMLElement']
const TOUCH = ['TouchEvent', 'HTMLElement']
const EVENT_TYPES = {
  click: MOUSE,
  dblclick: MOUSE,
  auxclick: MOUSE,
  contextmenu: MOUSE,
  mousedown: MOUSE,
  mouseup: MOUSE,
  mousemove: MOUSE,
  mouseenter: MOUSE,
  mouseleave: MOUSE,
  mouseover: MOUSE,
  mouseout: MOUSE,
  keydown: KEY,
  keyup: KEY,
  keypress: KEY,
  input: ['InputEvent', 'HTMLInputElement'],
  change: ['Event', 'HTMLInputElement'],
  submit: ['SubmitEvent', 'HTMLFormElement'],
  reset: ['Event', 'HTMLFormElement'],
  focus: FOCUS,
  blur: FOCUS,
  focusin: FOCUS,
  focusout: FOCUS,
  scroll: ['Event', 'HTMLElement'],
  wheel: ['WheelEvent', 'HTMLElement'],
  pointerdown: POINTER,
  pointerup: POINTER,
  pointermove: POINTER,
  pointerenter: POINTER,
  pointerleave: POINTER,
  pointercancel: POINTER,
  drag: DRAG,
  dragstart: DRAG,
  dragend: DRAG,
  dragenter: DRAG,
  dragleave: DRAG,
  dragover: DRAG,
  drop: DRAG,
  touchstart: TOUCH,
  touchmove: TOUCH,
  touchend: TOUCH,
  touchcancel: TOUCH,
}

function eventTypesFor(eventName) {
  return EVENT_TYPES[eventName.toLowerCase()] ?? ['Event', 'HTMLElement']
}

// Walks a parsed template AST (from parseTemplate) collecting every
// bindable expression as a tree of check entries, ready for
// buildVirtualPageTs to emit into a synthetic __render() method.
// Entries come in two kinds:
//   { kind: 'check', expr, line, eventType, eventBase } -- a single
//     expression to typecheck (interpolation, #if condition, dynamic
//     attribute). eventType/eventBase are set for event handlers.
//   { kind: 'each', itemName, indexName, iterableExpr, line, children }
//     -- an #each block; children is itself a list of these same entries
// The 'each' kind exists so the emitted TS can wrap its children in
// a real `for (const f of ...)` -- without an actual declaration for
// the loop variable, TS has no way to resolve identifiers like `f`
// inside the block, regardless of what our own scope-tracking says.
// {{#else}} branches are collected as ordinary entries after their
// block, in the OUTER scope (an each-else has no loop variable).
export function collectTemplateChecks(nodes, scope, out) {
  for (const node of nodes) {
    if (node.type === 'Interpolation') {
      out.push({
        kind: 'check',
        expr: typedTemplateExpr(node.expression, scope),
        line: node.line,
        eventType: null,
        eventBase: null,
      })
    } else if (node.type === 'If') {
      out.push({
        kind: 'check',
        expr: typedTemplateExpr(node.condition, scope),
        line: node.line,
        eventType: null,
        eventBase: null,
      })
      collectTemplateChecks(node.children, scope, out)
      if (node.elseChildren) {
        collectTemplateChecks(node.elseChildren, scope, out)
      }
    } else if (node.type === 'Each') {
      const iterableExpr = typedTemplateExpr(node.iterable, scope)
      const children = []
      const innerScope = new Set([
        ...scope,
        ...paramNames([node.itemName]),
        ...(node.indexName ? [node.indexName] : []),
      ])
      collectTemplateChecks(node.children, innerScope, children)
      out.push({
        kind: 'each',
        itemName: node.itemName,
        indexName: node.indexName ?? null,
        iterableExpr,
        line: node.line,
        children,
      })
      if (node.elseChildren) {
        collectTemplateChecks(node.elseChildren, scope, out)
      }
    } else if (node.type === 'Element') {
      for (const attr of node.attributes) {
        if (!attr.dynamic) continue
        const eventMatch = EVENT_ATTR_RE.exec(attr.name)
        const attrScope = eventMatch
          ? new Set([...scope, '$event', 'event'])
          : scope
        const [eventBase, eventType] = eventMatch
          ? eventTypesFor(eventMatch[1])
          : [null, null]
        out.push({
          kind: 'check',
          expr: typedTemplateExpr(attr.value, attrScope),
          line: attr.line,
          eventType,
          eventBase,
        })
      }
      collectTemplateChecks(node.children, scope, out)
    }
  }
}