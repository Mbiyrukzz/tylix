import { generateTemplateExpression } from './generateTemplateExpression.js'
import { paramNames } from './jsGlobals.js'

// Any attribute named on<event> on a plain HTML element is an event
// listener: onclick, onkeydown, onblur, onmouseenter, ondblclick,
// onscroll, onsubmit, oninput, oncontextmenu, ... (case-insensitive,
// so onClick works too). Capitalized component tags handle their own
// onXxx callback props separately in compileElement.
const EVENT_ATTR_PREFIX = /^on[a-z]+$/i
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
    lines.push(`effect(() => { ${varName}.nodeValue = ${expr}; });`)
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

  throw new Error(`generateTemplate: unknown node type "${node.type}"`)
}

// Renders node.children into a local fragment and returns the lines
// needed to build it plus the fragment's own variable name, without
// touching the caller's `lines` array directly (used inside effect
// callbacks below, which need their own nested block of statements).
function compileChildrenIntoFragment(children, scope, fragVar, inSvg = false) {
  const childLines = []
  const childVars = children.map((child) =>
    compileNode(child, childLines, scope, inSvg),
  )
  childLines.push(...childVars.map((v) => `${fragVar}.appendChild(${v});`))
  return childLines
}

function emitBranch(lines, children, scope, inSvg, indent) {
  compileChildrenIntoFragment(children, scope, 'frag', inSvg).forEach((l) =>
    lines.push(`${indent}${l}`),
  )
}

// Conditional rendering with no VDOM: an anchor comment node marks
// the block's position; on first run (before the anchor is even
// attached to the real DOM by the caller) content builds into the
// same fragment that holds the anchor. On every later run (state
// changed), previous nodes are removed and new ones inserted right
// after the anchor in the live DOM. `{{#else}}` / `{{#else if}}`
// branches render into the same slot when the condition is false.
function compileIf(node, lines, scope, inSvg = false) {
  const anchorVar = nextVar('ifAnchor')
  const containerVar = nextVar('ifContainer')
  const nodesVar = nextVar('ifNodes')
  const initialVar = nextVar('ifInitial')

  // `{{#else if}}` chains (and an {{#else}} holding nothing but one
  // {{#if}}, which means the same thing) are flattened into a single
  // if / else if / else so the whole chain is ONE effect. Nesting
  // them would leave stale effects from replaced branches subscribed
  // to the same state.
  const branches = []
  let current = node
  let finalElse = null
  while (true) {
    branches.push({
      cond: generateTemplateExpression(current.condition, scope),
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

  lines.push(`const ${anchorVar} = document.createComment("if");`)
  lines.push(`const ${containerVar} = document.createDocumentFragment();`)
  lines.push(`${containerVar}.appendChild(${anchorVar});`)
  lines.push(`let ${nodesVar} = [];`)
  lines.push(`let ${initialVar} = true;`)
  lines.push(`effect(() => {`)
  lines.push(`  for (const n of ${nodesVar}) n.remove();`)
  lines.push(`  ${nodesVar} = [];`)
  lines.push(`  const frag = document.createDocumentFragment();`)
  branches.forEach((b, i) => {
    lines.push(i === 0 ? `  if (${b.cond}) {` : `  } else if (${b.cond}) {`)
    emitBranch(lines, b.children, scope, inSvg, '    ')
  })
  if (finalElse) {
    lines.push(`  } else {`)
    emitBranch(lines, finalElse, scope, inSvg, '    ')
  }
  lines.push(`  }`)
  lines.push(`  ${nodesVar} = Array.from(frag.childNodes);`)
  lines.push(`  if (${nodesVar}.length > 0) {`)
  lines.push(`    if (${initialVar}) { ${containerVar}.appendChild(frag); }`)
  lines.push(
    `    else if (${anchorVar}.parentNode) { ${anchorVar}.parentNode.insertBefore(frag, ${anchorVar}.nextSibling); }`,
  )
  lines.push(`  }`)
  lines.push(`  ${initialVar} = false;`)
  lines.push(`});`)

  return containerVar
}

// {{#each item in items}}, {{#each item, i in items}},
// {{#each [k, v] in Object.entries(o)}}, {{#each { id } in rows}}.
// `{{#else}}` renders when the list is empty.
function compileEach(node, lines, scope, inSvg = false) {
  const anchorVar = nextVar('eachAnchor')
  const containerVar = nextVar('eachContainer')
  const nodesVar = nextVar('eachNodes')
  const initialVar = nextVar('eachInitial')
  const iterableExpr = generateTemplateExpression(node.iterable, scope)
  const innerScope = new Set([
    ...scope,
    ...paramNames([node.itemName]),
    ...(node.indexName ? [node.indexName] : []),
  ])
  const hasElse = !!node.elseChildren
  const listVar = nextVar('eachList')
  const indexVar = nextVar('eachIndex')

  lines.push(`const ${anchorVar} = document.createComment("each");`)
  lines.push(`const ${containerVar} = document.createDocumentFragment();`)
  lines.push(`${containerVar}.appendChild(${anchorVar});`)
  lines.push(`let ${nodesVar} = [];`)
  lines.push(`let ${initialVar} = true;`)
  lines.push(`effect(() => {`)
  lines.push(`  for (const n of ${nodesVar}) n.remove();`)
  lines.push(`  const frag = document.createDocumentFragment();`)
  if (hasElse) {
    lines.push(`  const ${listVar} = Array.from(${iterableExpr} ?? []);`)
  }
  if (node.indexName) lines.push(`  let ${indexVar} = 0;`)
  lines.push(
    `  for (const ${node.itemName} of ${hasElse ? listVar : iterableExpr}) {`,
  )
  if (node.indexName) {
    lines.push(`    const ${node.indexName} = ${indexVar}++;`)
  }
  emitBranch(lines, node.children, innerScope, inSvg, '    ')
  lines.push(`  }`)
  if (hasElse) {
    lines.push(`  if (${listVar}.length === 0) {`)
    emitBranch(lines, node.elseChildren, scope, inSvg, '    ')
    lines.push(`  }`)
  }
  lines.push(`  ${nodesVar} = Array.from(frag.childNodes);`)
  lines.push(`  if (${nodesVar}.length > 0) {`)
  lines.push(`    if (${initialVar}) { ${containerVar}.appendChild(frag); }`)
  lines.push(
    `    else if (${anchorVar}.parentNode) { ${anchorVar}.parentNode.insertBefore(frag, ${anchorVar}.nextSibling); }`,
  )
  lines.push(`  }`)
  lines.push(`  ${initialVar} = false;`)
  lines.push(`});`)

  return containerVar
}

function isComponentTag(tag) {
  return COMPONENT_TAG_PATTERN.test(tag)
}

function compileElement(node, lines, scope, inSvg = false) {
  if (isComponentTag(node.tag)) {
    const varName = nextVar('component')
    const tagLiteral = JSON.stringify(node.tag)

    const propEntries = node.attributes.map((attr) => {
      let expr
      if (attr.dynamic) {
        expr = generateTemplateExpression(attr.value, scope)
        // Callback props (onXxx="{{ methodName }}") pass a bare
        // instance-method reference. `generateTemplateExpression`
        // turns `methodName` into `instance.methodName`, but handing
        // that off as a plain value loses its `this` binding the
        // moment the child calls it. Bind it here, while we still
        // have `instance` in scope.
        if (/^on[A-Z]/.test(attr.name) && attr.value.type === 'Identifier') {
          expr = `(${expr}).bind(instance)`
        }
      } else {
        expr = JSON.stringify(attr.value)
      }
      return `${JSON.stringify(attr.name)}: ${expr}`
    })
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
  // correct in the DOM inspector (right tag name, right attributes),
  // which is exactly what made this bug so hard to spot.
  const isSvgRoot = node.tag === 'svg'
  const nsForThisNode = inSvg || isSvgRoot
  const childInSvg = isSvgRoot ? true : inSvg

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

  for (const attr of node.attributes) {
    compileAttribute(varName, node.tag, attr, lines, scope)
  }

  for (const child of node.children) {
    const childVar = compileNode(child, lines, scope, childInSvg)
    lines.push(`${varName}.appendChild(${childVar});`)
  }

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
// their string value -- setAttribute(name, "false") is still
// truthy to the browser, same as "true" or "". These need
// add/removeAttribute based on the JS value's truthiness, not a
// literal setAttribute call with the stringified value.
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
  if (EVENT_ATTR_PREFIX.test(attr.name)) {
    const eventName = attr.name.slice(2).toLowerCase()
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

    if (FUNCTION_VALUED.has(attr.value.type)) {
      // Function value: call it with the event.
      lines.push(
        `${elVar}.addEventListener(${JSON.stringify(eventName)}, ($event) => { const event = $event; ${expr}($event); });`,
      )
      return
    }

    // Statement: run it when the event fires. Handlers that contain
    // `await` become async arrows.
    const asyncPrefix = /\bawait\b/.test(expr) ? 'async ' : ''
    lines.push(
      `${elVar}.addEventListener(${JSON.stringify(eventName)}, ${asyncPrefix}($event) => { const event = $event; ${expr}; });`,
    )
    return
  }

  if (attr.dynamic) {
    const expr = generateTemplateExpression(attr.value, scope)
    const useProperty =
      LIVE_PROPERTY_ATTRS.has(attr.name) && LIVE_PROPERTY_TAGS.has(tag)
    const useBoolean = BOOLEAN_ATTRS.has(attr.name) && !useProperty
    if (useProperty) {
      // Set the live DOM property, not the attribute, so re-renders
      // after the user has typed (e.g. clearing the form on submit)
      // actually update what's on screen.
      lines.push(`effect(() => { ${elVar}.${attr.name} = ${expr}; });`)
    } else if (useBoolean) {
      // Boolean attribute: presence, not string value, is what
      // matters to the browser. Add it (empty string) when truthy,
      // remove it entirely when falsy.
      lines.push(
        `effect(() => { if (${expr}) { ${elVar}.setAttribute(${JSON.stringify(attr.name)}, ""); } else { ${elVar}.removeAttribute(${JSON.stringify(attr.name)}); } });`,
      )
    } else {
      lines.push(
        `effect(() => { ${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${expr}); });`,
      )
    }
    return
  }

  lines.push(
    `${elVar}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});`,
  )
}