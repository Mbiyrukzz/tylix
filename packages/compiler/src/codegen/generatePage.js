import { generateMethod } from './generateMethod.js'
import { generateExpression } from './generateExpression.js'
import { generateStatement } from './generateStatement.js'

function statementSource(stmt) {
  return generateStatement(stmt)
}

// A prop, state field, computed, action or capability that share a
// name all become members of the same class, so the later definition
// silently wins (or the constructor throws). Catch it at compile time.
function assertUniqueMembers(pageNode, className, capabilityNames) {
  const seen = new Map()
  const claim = (name, kind) => {
    if (seen.has(name)) {
      throw new Error(
        `${className}: "${name}" is declared as both ${seen.get(name)} and ${kind}; names must be unique within a page`,
      )
    }
    seen.set(name, kind)
  }
  for (const p of pageNode.props ?? []) claim(p.name, 'a prop')
  for (const s of pageNode.state ?? []) claim(s.name, 'a state field')
  for (const c of pageNode.computed ?? []) claim(c.name, 'a computed')
  for (const a of pageNode.actions ?? []) claim(a.name, 'an action')
  for (const n of capabilityNames) claim(n, 'a capability')
}

/**
 * Compiles a full PageNode into JS source defining a component class.
 * - props are lazy getters over `this.__props`, so a parent that
 *   passes `{ get value() { return count } }` stays live. Assigning
 *   to a prop stores a local (reactive) override.
 * - state entries become reactive-backed getter/setter pairs, so
 *   `this.count` reads/writes go through the reactive() proxy and
 *   correctly trigger dependent effects (template re-renders, computed
 *   re-evaluation) without any special-casing in the method codegen.
 * - uses entries become read-only getters that resolve a named
 *   capability from the shared runtime registry -- unlike state,
 *   there's no matching setter, since capabilities are singletons
 *   owned by the registry, not per-page instance data.
 * - computed entries become plain getters (their body already contains
 *   a `return` statement from the parser).
 * - action entries become plain instance methods.
 *
 * The generated class expects `reactive` and `resolveCapability` to be
 * in scope where the module is evaluated (imported from
 * @tylix/compiler's runtime).
 */
export function generatePage(pageNode, className = 'Page', target = 'client') {
  // pageNode.uses/needs/background may each name capabilities the page
  // reads from directly (Auth.user, Theme.mode, etc.) --
  // substituteCapabilityRefs already treats all three as the same
  // "capability name" pool when rewriting bare references to
  // `this.<Name>`, so the getters generated here must cover the same
  // pool, not just `uses` alone.
  const capabilityRefs = [
    ...(pageNode.uses ?? []),
    ...(pageNode.needs ?? []),
    ...(pageNode.background ?? []),
  ]
  const seenCapabilities = new Set()
  const uniqueCapabilityRefs = capabilityRefs.filter((c) => {
    if (seenCapabilities.has(c.name)) return false
    seenCapabilities.add(c.name)
    return true
  })

  assertUniqueMembers(pageNode, className, seenCapabilities)

  const hasProps = pageNode.props.length > 0
  const propInit = hasProps
    ? `    this.__props = props;\n    this.__propOverrides = reactive({});\n`
    : ''

  const propAccessors = pageNode.props
    .map(
      (p) => `  get ${p.name}() {
    const overrides = this.__propOverrides;
    const local = overrides.${p.name};
    return Object.prototype.hasOwnProperty.call(overrides, ${JSON.stringify(p.name)}) ? local : this.__props.${p.name};
  }
  set ${p.name}(value) {
    this.__propOverrides.${p.name} = value;
  }`,
    )
    .join('\n\n')

  const stateInit = pageNode.state
    .map((s) => `      ${s.name}: ${generateExpression(s.value)},`)
    .join('\n')

  const stateAccessors = pageNode.state
    .map(
      (s) => `  get ${s.name}() {
    return this.__state.${s.name};
  }
  set ${s.name}(value) {
    this.__state.${s.name} = value;
  }`,
    )
    .join('\n\n')

  const usesAccessors = uniqueCapabilityRefs
    .map(
      (u) => `  get ${u.name}() {
    return resolveCapability(${JSON.stringify(u.name)});
  }`,
    )
    .join('\n\n')

  const computedGetters = pageNode.computed
    .map((c) => {
      const body = c.body
        .map((stmt) => `    ${statementSource(stmt)}`)
        .join('\n')
      return `  get ${c.name}() {\n${body}\n  }`
    })
    .join('\n\n')

  const actionMethods = pageNode.actions
    .map((a) => generateMethod(a))
    .join('\n\n')

  const needsResolution = (pageNode.needs ?? [])
    .map(
      (n) => `    await resolveCapability(${JSON.stringify(n.name)}).ready();`,
    )
    .join('\n')

  const prefetchResolution = (pageNode.prefetch ?? [])
    .map((p) => {
      const argsSrc = p.args
        ? p.args.map((a) => generateExpression(a)).join(', ')
        : ''
      return `    await resolveCapability(${JSON.stringify(p.capability)}).${p.member}(${argsSrc});`
    })
    .join('\n')

  const backgroundResolution = (pageNode.background ?? [])
    .map((b) => `    resolveCapability(${JSON.stringify(b.name)});`) // fire-and-forget, no await
    .join('\n')

  const readyBody = [needsResolution, prefetchResolution]
    .filter(Boolean)
    .join('\n')

  const readyMethod = readyBody ? `  async __ready() {\n${readyBody}\n  }` : ''

  // onMount is only ever emitted into the class at all when
  // generating for the client bundle. Server-side (SSR) output never
  // contains the onMount call OR its method body -- there's no
  // runtime guard to rely on, because the code simply isn't there.
  //
  // onMount is not invoked from inside the constructor: pages that
  // declare `needs` capabilities must have those capabilities' async
  // init() fully resolved (via __ready()) before onMount runs. The
  // caller (renderPageDocument.js) awaits __ready() and then calls
  // __onMount() explicitly, in that order -- for pages, layouts and
  // child components alike.
  const onMountMethod =
    pageNode.onMount && target === 'client'
      ? (() => {
          const body = pageNode.onMount.body
            .map((stmt) => `    ${statementSource(stmt)}`)
            .join('\n')
          const asyncPrefix = pageNode.onMount.isAsync ? 'async ' : ''
          return `  ${asyncPrefix}__onMount() {\n${body}\n  }`
        })()
      : ''

  return `class ${className} {
  constructor(props = {}) {
${propInit}    this.__state = reactive({
${stateInit}
    });
${backgroundResolution ? backgroundResolution + '\n' : ''}  }

${[propAccessors, stateAccessors, usesAccessors, computedGetters, actionMethods, readyMethod, onMountMethod].filter(Boolean).join('\n\n')}
}`
}