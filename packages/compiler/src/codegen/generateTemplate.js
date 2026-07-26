import { generateTemplateExpression } from './generateTemplateExpression.js'

const EVENT_ATTR_PREFIX = /^on(click|input|change|submit)$/i
const COMPONENT_TAG_PATTERN = /^[A-Z]/

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
  const rootVars = nodes.map((node) => compileNode(node, lines, new Set()))

  if (rootVars.length === 1) {
    return { code: lines.join('\n'), rootVar: rootVars[0] }
  }

  const fragmentVar = nextVar('fragment')
  lines.push(`const ${fragmentVar} = document.createDocumentFragment();`)
  rootVars.forEach((v) => lines.push(`${fragmentVar}.appendChild(${v});`))
  return { code: lines.join('\n'), rootVar: fragmentVar }
}

function compileNode(node, lines, scope) {
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
    return compileIf(node, lines, scope)
  }

  if (node.type === 'Each') {
    return compileEach(node, lines, scope)
  }

  if (node.type === 'Element') {
    return compileElement(node, lines, scope)
  }

  throw new Error(`generateTemplate: unknown node type "${node.type}"`)
}

// Renders node.children into a local fragment and returns the lines
// needed to build it plus the fragment's own variable name, without
// touching the caller's `lines` array directly (used inside effect
// callbacks below, which need their own nested block of statements).
function compileChildrenIntoFragment(children, scope, fragVar) {
  const childLines = []
  const childVars = children.map((child) =>
    compileNode(child, childLines, scope),
  )
  childLines.push(...childVars.map((v) => `${fragVar}.appendChild(${v});`))
  return childLines
}

// Conditional rendering with no VDOM: an anchor comment node marks
// the block's position; on first run (before the anchor is even
// attached to the real DOM by the caller) content builds into the
// same fragment that holds the anchor. On every later run (state
// changed), previous nodes are removed and new ones inserted right
// after the anchor in the live DOM.
function compileIf(node, lines, scope) {
  const anchorVar = nextVar('ifAnchor')
  const containerVar = nextVar('ifContainer')
  const nodesVar = nextVar('ifNodes')
  const initialVar = nextVar('ifInitial')
  const condExpr = generateTemplateExpression(node.condition, scope)

  lines.push(`const ${anchorVar} = document.createComment("if");`)
  lines.push(`const ${containerVar} = document.createDocumentFragment();`)
  lines.push(`${containerVar}.appendChild(${anchorVar});`)
  lines.push(`let ${nodesVar} = [];`)
  lines.push(`let ${initialVar} = true;`)
  lines.push(`effect(() => {`)
  lines.push(`  for (const n of ${nodesVar}) n.remove();`)
  lines.push(`  ${nodesVar} = [];`)
  lines.push(`  if (${condExpr}) {`)
  lines.push(`    const frag = document.createDocumentFragment();`)
  const childLines = compileChildrenIntoFragment(node.children, scope, 'frag')
  childLines.forEach((l) => lines.push(`    ${l}`))
  lines.push(`    ${nodesVar} = Array.from(frag.childNodes);`)
  lines.push(`    if (${initialVar}) { ${containerVar}.appendChild(frag); }`)
  lines.push(
    `    else { ${anchorVar}.parentNode.insertBefore(frag, ${anchorVar}.nextSibling); }`,
  )
  lines.push(`  }`)
  lines.push(`  ${initialVar} = false;`)
  lines.push(`});`)

  return containerVar
}

// List rendering, same anchor/rebuild strategy as compileIf, but
// iterating a reactive array each time the effect runs. Not keyed
// diffing -- every dependency change rebuilds the whole list, which
// is the deliberate simplification for v1.
function compileEach(node, lines, scope) {
  const anchorVar = nextVar('eachAnchor')
  const containerVar = nextVar('eachContainer')
  const nodesVar = nextVar('eachNodes')
  const initialVar = nextVar('eachInitial')
  const iterableExpr = generateTemplateExpression(node.iterable, scope)
  const innerScope = new Set([...scope, node.itemName])

  lines.push(`const ${anchorVar} = document.createComment("each");`)
  lines.push(`const ${containerVar} = document.createDocumentFragment();`)
  lines.push(`${containerVar}.appendChild(${anchorVar});`)
  lines.push(`let ${nodesVar} = [];`)
  lines.push(`let ${initialVar} = true;`)
  lines.push(`effect(() => {`)
  lines.push(`  for (const n of ${nodesVar}) n.remove();`)
  lines.push(`  const frag = document.createDocumentFragment();`)
  lines.push(`  for (const ${node.itemName} of ${iterableExpr}) {`)
  const childLines = compileChildrenIntoFragment(
    node.children,
    innerScope,
    'frag',
  )
  childLines.forEach((l) => lines.push(`    ${l}`))
  lines.push(`  }`)
  lines.push(`  ${nodesVar} = Array.from(frag.childNodes);`)
  lines.push(`  if (${initialVar}) { ${containerVar}.appendChild(frag); }`)
  lines.push(
    `  else { ${anchorVar}.parentNode.insertBefore(frag, ${anchorVar}.nextSibling); }`,
  )
  lines.push(`  ${initialVar} = false;`)
  lines.push(`});`)

  return containerVar
}

function isComponentTag(tag) {
  return COMPONENT_TAG_PATTERN.test(tag)
}

function compileElement(node, lines, scope) {
  if (isComponentTag(node.tag)) {
    const varName = nextVar('component')
    const tagLiteral = JSON.stringify(node.tag)

    const propEntries = node.attributes.map((attr) => {
      const expr = attr.dynamic
        ? generateTemplateExpression(attr.value, scope)
        : JSON.stringify(attr.value)
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

  const varName = nextVar('el')
  lines.push(
    `const ${varName} = document.createElement(${JSON.stringify(node.tag)});`,
  )

  for (const attr of node.attributes) {
    compileAttribute(varName, node.tag, attr, lines, scope)
  }

  for (const child of node.children) {
    const childVar = compileNode(child, lines, scope)
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

    if (
      attr.value.type === 'CallExpression' ||
      attr.value.type === 'AssignmentExpression'
    ) {
      const expr = generateTemplateExpression(attr.value, scopeWithEvent)
      lines.push(
        `${elVar}.addEventListener(${JSON.stringify(eventName)}, ($event) => { const event = $event; ${expr}; });`,
      )
      return
    }

    const expr = generateTemplateExpression(attr.value, scopeWithEvent)
    lines.push(
      `${elVar}.addEventListener(${JSON.stringify(eventName)}, ($event) => { const event = $event; ${expr}($event); });`,
    )
    return
  }
  if (attr.dynamic) {
    const expr = generateTemplateExpression(attr.value, scope)
    const useProperty =
      LIVE_PROPERTY_ATTRS.has(attr.name) && LIVE_PROPERTY_TAGS.has(tag)
    if (useProperty) {
      // Set the live DOM property, not the attribute, so re-renders
      // after the user has typed (e.g. clearing the form on submit)
      // actually update what's on screen.
      lines.push(`effect(() => { ${elVar}.${attr.name} = ${expr}; });`)
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
