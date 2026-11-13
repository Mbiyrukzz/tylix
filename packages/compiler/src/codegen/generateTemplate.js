import { generateTemplateExpression } from './generateTemplateExpression.js'
import { paramNames } from './jsGlobals.js'

// Any attribute named on<event> on a plain HTML element is an event
// listener: onclick, onkeydown, onblur, onmouseenter, ondblclick,
// onscroll, onsubmit, oninput, oncontextmenu, ... (case-insensitive,
// so onClick works too). Capitalized component tags handle their own
// onXxx callback props separately in compileElement.
const EVENT_ATTR_PREFIX = /^on[a-z]+$/i
// onclick.prevent.stop, onkeydown.enter, onsubmit.prevent ...
const EVENT_WITH_MODIFIERS = /^on([a-z]+)((?:\.[a-z0-9]+)*)$/i

const KEY_MODIFIERS = {
  enter: ['Enter'],
  esc: ['Escape'],
  escape: ['Escape'],
  space: [' ', 'Spacebar'],
  tab: ['Tab'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  delete: ['Delete', 'Backspace'],
  backspace: ['Backspace'],
}
const SYSTEM_MODIFIERS = { ctrl: 'ctrlKey', shift: 'shiftKey', alt: 'altKey', meta: 'metaKey' }
const OPTION_MODIFIERS = { once: 'once: true', capture: 'capture: true', passive: 'passive: true' }

// Turns modifiers into guard statements run before the handler, and
// addEventListener options.
function eventModifiers(modifiers, attr) {
  const checks = []
  const actions = []
  const options = []
  const keys = []
  for (const m of modifiers) {
    const lower = m.toLowerCase()
    if (lower === 'prevent') actions.push('$event.preventDefault();')
    else if (lower === 'stop') actions.push('$event.stopPropagation();')
    else if (lower === 'self') checks.push('$event.target !== $event.currentTarget')
    else if (OPTION_MODIFIERS[lower]) options.push(OPTION_MODIFIERS[lower])
    else if (SYSTEM_MODIFIERS[lower]) checks.push(`!$event.${SYSTEM_MODIFIERS[lower]}`)
    else if (KEY_MODIFIERS[lower]) keys.push(...KEY_MODIFIERS[lower])
    else {
      throw new Error(
        `Unknown event modifier ".${m}" on ${attr.name} (line ${attr.line}). Use prevent, stop, self, once, capture, passive, ctrl, shift, alt, meta, or a key: ${Object.keys(KEY_MODIFIERS).join(', ')}`,
      )
    }
  }
  if (keys.length) checks.unshift(`!${JSON.stringify(keys)}.includes($event.key)`)
  if (options.includes('passive: true') && actions.includes('$event.preventDefault();')) {
    throw new Error(`${attr.name}: .passive and .prevent cannot be combined (line ${attr.line})`)
  }
  const guards = (checks.length ? `if (${checks.join(' || ')}) return; ` : '') + actions.join(' ') + (actions.length ? ' ' : '')
  return { guards, options }
}
const COMPONENT_TAG_PATTERN = /^[A-Z]/

// A handler whose expression is one of these node types is a function
// VALUE that gets called with the event: onclick="{{ save }}",
// "{{ Auth.logout }}", "{{ e => doIt(e.target.value) }}". Anything
// else is a STATEMENT run when the event fires: "{{ count++ }}",
// "{{ save(item) }}", "{{ ok and save() }}", "{{ open ? close() : open() }}".
const FUNCTION_VALUED = new Set([
  'Identifier',
  'MemberExpression',
  'ArrowFunctionExpression',
])

const SVG_NS = 'http://www.w3.org/2000/svg'

let nodeCounter = 0
function nextVar(prefix) {
  return `${prefix}${nodeCounter++}`
}

// Wraps a render-time expression so a throw (for example
// `post.createdAt.toLocaleDateString()` while `post` is still null)
// is logged with its template line and replaced by `fallback`, instead
// of aborting the whole mount. Reads made before the throw are still
// tracked, so the effect re-runs once the data arrives. Not used for
// event handlers, which already report errors through the browser.
function guard(exprSrc, fallback, what, line) {
  const where = line ? ` at line ${line}` : ''
  const label = JSON.stringify(`Tylix: error in ${what}${where}:`)
  return `(() => { try { return ${exprSrc}; } catch (e) { console.error(${label}, e); return ${fallback}; } })()`
}

/**
 * Compiles a template AST into the BODY of a render(instance,
 * document, components) function as a JS source string. No virtual
 * DOM: state changes update exactly the text/attribute/if-branch/
 * each-list that depends on them. `scope` tracks local names (each
 * loop variables) so they're referenced bare instead of prefixed with
 * "instance.".
 */
export function generateTemplate(nodes) {
  nodeCounter = 0
  const lines = []
  const rootVars = nodes.map((node) =>
    compileNode(node, lines, new Set(), false),
  )

  if (rootVars.length === 1) {
    return { code: lines.join('\n'), rootVar: rootVars[0] }
  }

  const fragmentVar = nextVar('fragment')
  lines.push(`const ${fragmentVar} = document.createDocumentFragment();`)
  rootVars.forEach((v) => lines.push(`${fragmentVar}.appendChild(${v});`))
  return { code: lines.join('\n'), rootVar: fragmentVar }
}

function compileNode(node, lines, scope, inSvg = false) {
  if (node.type === 'Text') {
    const varName = nextVar('text')
    lines.push(
      `const ${varName} = document.createTextNode(${JSON.stringify(node.value)});`,
    )
    return varName
  }

  if (node.type === 'Interpolation') {
    const varName = nextVar('text')
    const expr = generateTemplateExpression(node.expression, scope)
    lines.push(`const ${varName} = document.createTextNode("");`)
    lines.push(
      `effect(() => { const __v = ${guard(expr, '""', '{{ }} interpolation', node.line)}; ${varName}.nodeValue = __v == null ? "" : __v; });`,
    )
    return varName
  }

  if (node.type === 'If') {
    return compileIf(node, lines, scope, inSvg)
  }

  if (node.type === 'Each') {
    return compileEach(node, lines, scope, inSvg)
  }

  if (node.type === 'Element') {
    return compileElement(node, lines, scope, inSvg)
  }

  if (node.type === 'Await') {
    return compileAwait(node, lines, scope, inSvg)
  }

  if (node.type === 'RawHtml') {
    const startVar = nextVar('htmlStart')
    const endVar = nextVar('htmlEnd')
    const containerVar = nextVar('htmlContainer')
    const expr = guard(generateTemplateExpression(node.expression, scope), '""', '{{@html}}', node.line)
    emitRangeOpen(lines, startVar, endVar, containerVar, 'html')
    // <template> parses the markup without running any <script> in it.
    lines.push(`  const __v = ${expr};`)
    lines.push(`  const __t = document.createElement("template");`)
    lines.push(`  __t.innerHTML = __v == null ? "" : String(__v);`)
    lines.push(`  __frag.appendChild(__t.content);`)
    emitRangeClose(lines, endVar)
    return containerVar
  }

  throw new Error(`generateTemplate: unknown node type "${node.type}"`)
}

// Renders node.children into a local fragment and returns the lines
// needed to build it, without touching the caller's `lines` array
// directly (used inside effect callbacks below, which need their own
// nested block of statements).
function compileChildrenIntoFragment(children, scope, fragVar, inSvg = false) {
  const childLines = []
  const childVars = children.map((child) =>
    compileNode(child, childLines, scope, inSvg),
  )
  childLines.push(...childVars.map((v) => `${fragVar}.appendChild(${v});`))
  return childLines
}

function emitBranch(lines, children, scope, inSvg, indent) {
  compileChildrenIntoFragment(children, scope, '__frag', inSvg).forEach((l) =>
    lines.push(`${indent}${l}`),
  )
}

// Every {{#if}} / {{#each}} block owns the DOM range BETWEEN two
// comment markers (start, end). On every run the whole range is
// cleared and the new content is inserted before the end marker.
// Because nested blocks live inside the parent's range, a parent
// re-run also removes whatever its children inserted later -- the old
// "remember the nodes from the first run" approach leaked those.
function emitRangeOpen(lines, startVar, endVar, containerVar, label) {
  lines.push(`const ${startVar} = document.createComment(${JSON.stringify(label)});`)
  lines.push(`const ${endVar} = document.createComment(${JSON.stringify('/' + label)});`)
  lines.push(`const ${containerVar} = document.createDocumentFragment();`)
  lines.push(`${containerVar}.appendChild(${startVar});`)
  lines.push(`${containerVar}.appendChild(${endVar});`)
  lines.push(`effect(() => {`)
  lines.push(
    `  while (${startVar}.nextSibling && ${startVar}.nextSibling !== ${endVar}) ${startVar}.nextSibling.remove();`,
  )
  lines.push(`  const __frag = document.createDocumentFragment();`)
}

function emitRangeClose(lines, endVar) {
  lines.push(
    `  if (${endVar}.parentNode) { ${endVar}.parentNode.insertBefore(__frag, ${endVar}); }`,
  )
  lines.push(`});`)
}

// Conditional rendering with no VDOM. `{{#else}}` / `{{#else if}}`
// branches render into the same slot when the condition is false.
function compileIf(node, lines, scope, inSvg = false) {
  const startVar = nextVar('ifStart')
  const endVar = nextVar('ifEnd')
  const containerVar = nextVar('ifContainer')

  // `{{#else if}}` chains (and an {{#else}} holding nothing but one
  // {{#if}}, which means the same thing) are flattened into a single
  // if / else if / else so the whole chain is ONE effect.
  const branches = []
  let current = node
  let finalElse = null
  while (true) {
    branches.push({
      cond: guard(
        generateTemplateExpression(current.condition, scope),
        'false',
        '{{#if}} condition',
        current.line,
      ),
      children: current.children,
    })
    const rest = current.elseChildren
    if (rest && rest.length === 1 && rest[0].type === 'If') {
      current = rest[0]
      continue
    }
    finalElse = rest
    break
  }

  emitRangeOpen(lines, startVar, endVar, containerVar, 'if')
  branches.forEach((b, i) => {
    lines.push(i === 0 ? `  if (${b.cond}) {` : `  } else if (${b.cond}) {`)
    emitBranch(lines, b.children, scope, inSvg, '    ')
  })
  if (finalElse) {
    lines.push(`  } else {`)
    emitBranch(lines, finalElse, scope, inSvg, '    ')
  }
  lines.push(`  }`)
  emitRangeClose(lines, endVar)

  return containerVar
}

// {{#await}}: one effect follows the promise expression and records
// where it is (pending / then / catch) in a plain holder, then bumps a
// reactive counter. The block's range effect reads that counter and
// renders the matching branch, so everything it creates (nested blocks,
// interpolations) has a normal owner and is disposed on the next run --
// nothing is rendered from inside the promise callback itself. A
// promise that settles after a newer one replaced it is ignored.
function compileAwait(node, lines, scope, inSvg = false) {
  const holder = nextVar('awaitState')
  const signal = nextVar('awaitSignal')
  const startVar = nextVar('awaitStart')
  const endVar = nextVar('awaitEnd')
  const containerVar = nextVar('awaitContainer')
  const expr = guard(generateTemplateExpression(node.promise, scope), 'undefined', '{{#await}} promise', node.line)
  const hasCatch = node.catchChildren !== null
  const where = JSON.stringify(`Tylix: {{#await}} at line ${node.line} rejected:`)

  lines.push(`const ${holder} = { phase: "pending", value: undefined, token: 0 };`)
  lines.push(`const ${signal} = reactive({ n: 0 });`)
  lines.push(`effect(() => {`)
  lines.push(`  const __p = ${expr};`)
  lines.push(`  const __token = ++${holder}.token;`)
  lines.push(`  if (__p != null && typeof __p.then === "function") {`)
  lines.push(`    ${holder}.phase = "pending"; ${holder}.value = undefined;`)
  lines.push(`    Promise.resolve(__p).then(`)
  lines.push(`      (__v) => { if (${holder}.token !== __token) return; ${holder}.phase = "then"; ${holder}.value = __v; untracked(() => { ${signal}.n++; }); },`)
  lines.push(`      (e) => { if (${holder}.token !== __token) return; ${hasCatch ? '' : `console.error(${where}, e); `}${holder}.phase = "catch"; ${holder}.value = e; untracked(() => { ${signal}.n++; }); },`)
  lines.push(`    );`)
  lines.push(`  } else {`)
  lines.push(`    ${holder}.phase = "then"; ${holder}.value = __p;`)
  lines.push(`  }`)
  lines.push(`  untracked(() => { ${signal}.n++; });`)
  lines.push(`});`)

  emitRangeOpen(lines, startVar, endVar, containerVar, 'await')
  lines.push(`  ${signal}.n;`)
  lines.push(`  if (${holder}.phase === "pending") {`)
  if (node.pending) emitBranch(lines, node.pending, scope, inSvg, '    ')
  lines.push(`  } else if (${holder}.phase === "then") {`)
  if (node.thenChildren) {
    if (node.thenName) lines.push(`    const ${node.thenName} = ${holder}.value;`)
    const inner = new Set([...scope, ...(node.thenName ? paramNames([node.thenName]) : [])])
    emitBranch(lines, node.thenChildren, inner, inSvg, '    ')
  }
  lines.push(`  } else {`)
  if (node.catchChildren) {
    if (node.catchName) lines.push(`    const ${node.catchName} = ${holder}.value;`)
    const inner = new Set([...scope, ...(node.catchName ? paramNames([node.catchName]) : [])])
    emitBranch(lines, node.catchChildren, inner, inSvg, '    ')
  }
  lines.push(`  }`)
  emitRangeClose(lines, endVar)
  return containerVar
}

// {{#each item in items}}, {{#each item, i in items}},
// {{#each [k, v] in Object.entries(o)}}, {{#each { id } in rows}}.
// `{{#else}}` renders when the list is empty. A null/undefined list
// (or one whose expression throws) renders as empty.
function compileEach(node, lines, scope, inSvg = false) {
  const startVar = nextVar('eachStart')
  const endVar = nextVar('eachEnd')
  const containerVar = nextVar('eachContainer')
  const listVar = nextVar('eachList')
  const indexVar = nextVar('eachIndex')
  const iterableExpr = generateTemplateExpression(node.iterable, scope)
  const innerScope = new Set([
    ...scope,
    ...paramNames([node.itemName]),
    ...(node.indexName ? [node.indexName] : []),
  ])

  emitRangeOpen(lines, startVar, endVar, containerVar, 'each')
  lines.push(
    `  const ${listVar} = Array.from(${guard(iterableExpr, '[]', '{{#each}} list', node.line)} ?? []);`,
  )
  if (node.indexName) lines.push(`  let ${indexVar} = 0;`)
  lines.push(`  for (const ${node.itemName} of ${listVar}) {`)
  if (node.indexName) {
    lines.push(`    const ${node.indexName} = ${indexVar}++;`)
  }
  emitBranch(lines, node.children, innerScope, inSvg, '    ')
  lines.push(`  }`)
  if (node.elseChildren) {
    lines.push(`  if (${listVar}.length === 0) {`)
    emitBranch(lines, node.elseChildren, scope, inSvg, '    ')
    lines.push(`  }`)
  }
  emitRangeClose(lines, endVar)

  return containerVar
}

function isComponentTag(tag) {
  return COMPONENT_TAG_PATTERN.test(tag)
}

function compileElement(node, lines, scope, inSvg = false) {
  if (isComponentTag(node.tag)) {
    const varName = nextVar('component')
    const tagLiteral = JSON.stringify(node.tag)

    for (const attr of node.attributes) {
      if (/^(bind|class|style):/.test(attr.name) || /^on[A-Za-z]+\./.test(attr.name)) {
        throw new Error(
          `<${node.tag}> ${attr.name}: bind:, class:, style: and event modifiers only work on HTML elements, not components (line ${attr.line})`,
        )
      }
    }
    const propEntries = node.attributes.map((attr) => {
      const key = JSON.stringify(attr.name)
      if (!attr.dynamic) return `${key}: ${JSON.stringify(attr.value)}`

      let expr = generateTemplateExpression(attr.value, scope)

      // Callback props (onXxx="{{ methodName }}") are plain values. A bare
      // instance-method reference loses its `this` the moment the child
      // calls it, so bind it here while `instance` is still in scope.
      if (/^on[A-Z]/.test(attr.name)) {
        if (attr.value.type === 'Identifier') expr = `(${expr}).bind(instance)`
        return `${key}: ${expr}`
      }

      // Everything else is a lazy getter: the child reads it inside its
      // own effects, so `<Child value="{{ count }}">` stays live instead
      // of being a snapshot taken at mount().
      return `get ${key}() { return ${guard(expr, 'undefined', `<${node.tag}> prop "${attr.name}"`, attr.line)}; }`
    })
    // Children become render functions the component calls from its
    // <slot> elements. They are compiled HERE, in the parent's scope,
    // so they see the parent's state and any {{#each}} variables.
    const slotFns = compileSlotFunctions(node, scope, inSvg)
    if (slotFns) propEntries.push(`"__slots": ${slotFns}`)
    const propsExpr = `{ ${propEntries.join(', ')} }`

    lines.push(`let ${varName};`)
    lines.push(`if (components[${tagLiteral}]) {`)
    lines.push(
      `  ${varName} = components[${tagLiteral}].mount(document, ${propsExpr}).node;`,
    )
    lines.push(`} else {`)
    lines.push(
      `  console.warn('Component "' + ${tagLiteral} + '" not found. Did you forget to restart tylix dev after creating it?');`,
    )
    lines.push(
      `  ${varName} = document.createComment(${tagLiteral} + ' not found');`,
    )
    lines.push(`}`)
    return varName
  }

  // Once we're inside an <svg>, every descendant (path, circle, g,
  // etc.) needs the SVG namespace too -- createElement() without a
  // namespace produces a non-rendering element that still LOOKS
  // correct in the DOM inspector.
  const isSvgRoot = node.tag === 'svg'
  const nsForThisNode = inSvg || isSvgRoot
  const childInSvg = isSvgRoot ? true : inSvg

  if (node.tag === 'slot' && !inSvg) {
    return compileSlot(node, lines, scope)
  }

  const varName = nextVar('el')
  if (nsForThisNode) {
    lines.push(
      `const ${varName} = document.createElementNS(${JSON.stringify(SVG_NS)}, ${JSON.stringify(node.tag)});`,
    )
  } else {
    lines.push(
      `const ${varName} = document.createElement(${JSON.stringify(node.tag)});`,
    )
  }

  const directives = { classes: [], styles: [], binds: [] }
  let classAttr = null
  let styleAttr = null
  for (const attr of node.attributes) {
    if (attr.name.startsWith('class:')) directives.classes.push(attr)
    else if (attr.name.startsWith('style:')) directives.styles.push(attr)
    else if (attr.name.startsWith('bind:')) directives.binds.push(attr)
    else if (attr.name === 'class' && attr.dynamic) classAttr = attr
    else if (attr.name === 'style' && attr.dynamic) styleAttr = attr
    else compileAttribute(varName, node.tag, attr, lines, scope)
  }
  compileClassAndStyle(varName, classAttr, styleAttr, directives, lines, scope)

  for (const child of node.children) {
    const childVar = compileNode(child, lines, scope, childInSvg)
    lines.push(`${varName}.appendChild(${childVar});`)
  }

  // After the children, so a <select>'s options exist before its value
  // is set.
  for (const attr of directives.binds) compileBind(varName, node, attr, lines, scope)

  return varName
}

// Attributes that reflect live user-editable DOM state -- setting
// them via setAttribute() only seeds the *initial* value; once the
// user interacts with the control, the live property diverges from
// the attribute and further setAttribute() calls stop being visible.
// These need the property set directly instead.
const LIVE_PROPERTY_ATTRS = new Set(['value', 'checked'])
const LIVE_PROPERTY_TAGS = new Set(['input', 'textarea', 'select'])

// Attributes where HTML only cares whether they're *present*, not
// their string value. These need add/removeAttribute based on the JS
// value's truthiness, not a literal setAttribute call.
const BOOLEAN_ATTRS = new Set([
  'disabled',
  'checked',
  'readonly',
  'required',
  'selected',
  'multiple',
  'hidden',
  'autofocus',
  'open',
])

function compileAttribute(elVar, tag, attr, lines, scope) {
  const eventMatch = EVENT_WITH_MODIFIERS.exec(attr.name)
  if (eventMatch && (eventMatch[2] || EVENT_ATTR_PREFIX.test(attr.name))) {
    const eventName = eventMatch[1].toLowerCase()
    const modifiers = eventMatch[2] ? eventMatch[2].slice(1).split('.') : []
    const { guards, options } = eventModifiers(modifiers, attr)
    if (!attr.dynamic) {
      throw new Error(
        `Event attribute "${attr.name}" must use {{ }} binding, got a static string.`,
      )
    }

    // Templates reference the DOM event as either "$event" or the
    // bare "event" -- both are treated as the same local so neither
    // gets mistakenly prefixed with "instance.".
    const scopeWithEvent = new Set([...scope, '$event', 'event'])
    const expr = generateTemplateExpression(attr.value, scopeWithEvent)

    const opts = options.length ? `, { ${options.join(', ')} }` : ''
    if (FUNCTION_VALUED.has(attr.value.type)) {
      // Function value: call it with the event.
      lines.push(
        `${elVar}.addEventListener(${JSON.stringify(eventName)}, ($event) => { const event = $event; ${guards}${expr}($event); }${opts});`,
      )
      return
    }

    // Statement: run it when the event fires. Handlers that contain
    // `await` become async arrows.
    const asyncPrefix = /\bawait\b/.test(expr) ? 'async ' : ''
    lines.push(
      `${elVar}.addEventListener(${JSON.stringify(eventName)}, ${asyncPrefix}($event) => { const event = $event; ${guards}${expr}; }${opts});`,
    )
    return
  }

  if (attr.dynamic) {
    const raw = generateTemplateExpression(attr.value, scope)
    const expr = guard(raw, 'undefined', `attribute "${attr.name}"`, attr.line)
    const nameLit = JSON.stringify(attr.name)
    const useProperty =
      LIVE_PROPERTY_ATTRS.has(attr.name) && LIVE_PROPERTY_TAGS.has(tag)
    const useBoolean = BOOLEAN_ATTRS.has(attr.name) && !useProperty

    if (useProperty) {
      // Set the live DOM property, not the attribute, so re-renders
      // after the user has typed actually update what's on screen.
      // `value` shows null/undefined as empty, `checked` is coerced.
      if (attr.name === 'value') {
        lines.push(
          `effect(() => { const __v = ${expr}; ${elVar}.value = __v == null ? "" : __v; });`,
        )
      } else {
        lines.push(`effect(() => { ${elVar}.${attr.name} = !!(${expr}); });`)
      }
    } else if (useBoolean) {
      // Boolean attribute: presence, not string value, is what
      // matters to the browser.
      lines.push(
        `effect(() => { if (${expr}) { ${elVar}.setAttribute(${nameLit}, ""); } else { ${elVar}.removeAttribute(${nameLit}); } });`,
      )
    } else {
      // null/undefined remove the attribute instead of writing the
      // string "undefined". false/0/"" are real values and are kept
      // (aria-expanded="false" must stay).
      lines.push(
        `effect(() => { const __v = ${expr}; if (__v == null) { ${elVar}.removeAttribute(${nameLit}); } else { ${elVar}.setAttribute(${nameLit}, __v); } });`,
      )
    }
    return
  }

  lines.push(
    `${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`,
  )
}

// <Card>children</Card>: children grouped by their slot="" attribute
// (default slot otherwise), each compiled into
// (document) => DocumentFragment, in the parent's scope.
function compileSlotFunctions(node, scope, inSvg) {
  const groups = new Map()
  for (const child of node.children) {
    let name = 'default'
    let target = child
    if (child.type === 'Element') {
      const slotAttr = child.attributes.find((a) => a.name === 'slot')
      if (slotAttr) {
        if (slotAttr.dynamic) {
          throw new Error(`slot="" must be a fixed name, not {{ }} (line ${slotAttr.line})`)
        }
        name = String(slotAttr.value)
        target = { ...child, attributes: child.attributes.filter((a) => a !== slotAttr) }
      }
    }
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(target)
  }
  if (groups.size === 0) return null
  const entries = [...groups].map(([name, children]) => {
    const body = compileChildrenIntoFragment(children, scope, '__frag', inSvg)
    return `${JSON.stringify(name)}: (document) => { const __frag = document.createDocumentFragment(); ${body.join(' ')} return __frag; }`
  })
  return `{ ${entries.join(', ')} }`
}

// <slot /> or <slot name="footer">fallback</slot> inside a component:
// what the parent passed for that slot, else the fallback children.
function compileSlot(node, lines, scope) {
  const nameAttr = node.attributes.find((a) => a.name === 'name')
  if (nameAttr && nameAttr.dynamic) {
    throw new Error(`<slot name=""> must be a fixed name, not {{ }} (line ${nameAttr.line})`)
  }
  const name = JSON.stringify(nameAttr ? String(nameAttr.value) : 'default')
  const varName = nextVar('slot')
  const fallback = compileChildrenIntoFragment(node.children, scope, '__frag', false)
  lines.push(
    `const ${varName} = (() => { const __slots = instance.__props && instance.__props.__slots; if (__slots && typeof __slots[${name}] === "function") return __slots[${name}](document); const __frag = document.createDocumentFragment(); ${fallback.join(' ')} return __frag; })();`,
  )
  return varName
}

// class:name="{{ cond }}", style:prop="{{ value }}", plus a dynamic
// class="" / style="". When both kinds are present they share ONE
// effect: rewriting the class attribute would otherwise drop classes
// a class: directive had added.
function compileClassAndStyle(elVar, classAttr, styleAttr, directives, lines, scope) {
  const valueOf = (attr, what) => {
    // class:active with no value is short for class:active="{{ active }}"
    if (!attr.dynamic) {
      const short = attr.name.split(':')[1]
      if (attr.value !== true || !/^[A-Za-z_$][\w$]*$/.test(short)) {
        throw new Error(`${attr.name} needs a {{ }} value (line ${attr.line})`)
      }
      return generateTemplateExpression({ type: 'Identifier', name: short }, scope)
    }
    return generateTemplateExpression(attr.value, scope)
  }

  const classToggles = directives.classes.map((attr) => {
    const name = attr.name.slice('class:'.length)
    if (!name) throw new Error(`class: needs a class name, like class:active (line ${attr.line})`)
    const cond = guard(valueOf(attr), 'false', `attribute "${attr.name}"`, attr.line)
    return `${elVar}.classList.toggle(${JSON.stringify(name)}, !!(${cond}));`
  })
  const styleSets = directives.styles.map((attr) => {
    let prop = attr.name.slice('style:'.length)
    if (!prop) throw new Error(`style: needs a property, like style:color (line ${attr.line})`)
    if (!prop.startsWith('--')) prop = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    const value = guard(valueOf(attr), 'undefined', `attribute "${attr.name}"`, attr.line)
    return `{ const __v = ${value}; if (__v == null || __v === false) { ${elVar}.style.removeProperty(${JSON.stringify(prop)}); } else { ${elVar}.style.setProperty(${JSON.stringify(prop)}, String(__v)); } }`
  })

  const setAttr = (attr) => {
    const v = guard(generateTemplateExpression(attr.value, scope), 'undefined', `attribute "${attr.name}"`, attr.line)
    return `{ const __v = ${v}; if (__v == null) { ${elVar}.removeAttribute(${JSON.stringify(attr.name)}); } else { ${elVar}.setAttribute(${JSON.stringify(attr.name)}, __v); } }`
  }

  if (classAttr) lines.push(`effect(() => { ${setAttr(classAttr)} ${classToggles.join(' ')} });`)
  else for (const t of classToggles) lines.push(`effect(() => { ${t} });`)
  if (styleAttr) lines.push(`effect(() => { ${setAttr(styleAttr)} ${styleSets.join(' ')} });`)
  else for (const t of styleSets) lines.push(`effect(() => { ${t} });`)
}

const BINDABLE = {
  value: new Set(['input', 'textarea', 'select']),
  checked: new Set(['input']),
  group: new Set(['input']),
}

// bind:value / bind:checked / bind:group: the element shows the value,
// and user input writes it back.
function compileBind(elVar, node, attr, lines, scope) {
  const prop = attr.name.slice('bind:'.length)
  const where = `${attr.name} on <${node.tag}> (line ${attr.line})`
  if (!BINDABLE[prop]) {
    throw new Error(`Unsupported ${where}: use bind:value, bind:checked or bind:group`)
  }
  if (!BINDABLE[prop].has(node.tag)) {
    throw new Error(`${where}: ${prop} can only be bound on ${[...BINDABLE[prop]].map((t) => `<${t}>`).join(', ')}`)
  }
  if (!attr.dynamic) throw new Error(`${where} needs a {{ }} value, like bind:value="{{ query }}"`)
  const target = attr.value
  const assignable =
    (target.type === 'Identifier' && !scope.has(target.name)) ||
    (target.type === 'MemberExpression' && !hasOptionalLink(target))
  if (!assignable) {
    throw new Error(`${where} must name a state field or a property (like {{ query }} or {{ item.done }}), not a computed value, loop variable or call`)
  }
  const lhs = generateTemplateExpression(target, scope)
  const read = guard(lhs, 'undefined', `attribute "${attr.name}"`, attr.line)
  const staticAttr = (name) => {
    const a = node.attributes.find((x) => x.name === name && !x.dynamic)
    return a ? String(a.value).toLowerCase() : null
  }
  const type = staticAttr('type')
  const multiple = node.attributes.some((a) => a.name === 'multiple')

  if (prop === 'checked') {
    lines.push(`effect(() => { ${elVar}.checked = !!(${read}); });`)
    lines.push(`${elVar}.addEventListener("change", () => { ${lhs} = ${elVar}.checked; });`)
    return
  }
  if (prop === 'group') {
    if (type !== 'radio' && type !== 'checkbox') throw new Error(`${where}: bind:group needs type="radio" or type="checkbox"`)
    if (type === 'radio') {
      lines.push(`effect(() => { ${elVar}.checked = ${read} === ${elVar}.value; });`)
      lines.push(`${elVar}.addEventListener("change", () => { if (${elVar}.checked) ${lhs} = ${elVar}.value; });`)
    } else {
      // checkbox group: the bound value is an array of checked values
      lines.push(`effect(() => { const __v = ${read}; ${elVar}.checked = Array.isArray(__v) && __v.includes(${elVar}.value); });`)
      lines.push(`${elVar}.addEventListener("change", () => { const __cur = Array.isArray(${lhs}) ? ${lhs}.filter((x) => x !== ${elVar}.value) : []; ${lhs} = ${elVar}.checked ? [...__cur, ${elVar}.value] : __cur; });`)
    }
    return
  }
  // value
  if (node.tag === 'select' && multiple) {
    lines.push(`effect(() => { const __v = ${read}; const __list = Array.isArray(__v) ? __v.map(String) : []; for (const o of ${elVar}.options) o.selected = __list.includes(o.value); });`)
    lines.push(`${elVar}.addEventListener("change", () => { ${lhs} = Array.from(${elVar}.selectedOptions, (o) => o.value); });`)
    return
  }
  if (type === 'checkbox' || type === 'radio') {
    throw new Error(`${where}: use bind:checked for a checkbox, or bind:group for radios`)
  }
  const numeric = type === 'number' || type === 'range'
  const event = node.tag === 'select' ? 'change' : 'input'
  const fromInput = numeric ? `(${elVar}.value === "" ? null : Number(${elVar}.value))` : `${elVar}.value`
  // Only write when the field shows something else, so typing is never
  // interrupted (for numbers, "1." and "1.0" already mean 1).
  const same = numeric
    ? `(${elVar}.value === "" ? __v == null : Number(${elVar}.value) === __v)`
    : `(${elVar}.value === __s)`
  lines.push(`effect(() => { const __v = ${read}; const __s = __v == null ? "" : String(__v); if (!${same}) ${elVar}.value = __s; });`)
  lines.push(`${elVar}.addEventListener(${JSON.stringify(event)}, () => { ${lhs} = ${fromInput}; });`)
}

// a?.b.c is not assignable either.
function hasOptionalLink(node) {
  for (let n = node; n && n.type === 'MemberExpression'; n = n.object) {
    if (n.optional) return true
  }
  return false
}
