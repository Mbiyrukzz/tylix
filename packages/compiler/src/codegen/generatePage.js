import { generateMethod } from './generateMethod.js'
import { generateExpression } from './generateExpression.js'

/**
 * Compiles a full PageNode into JS source defining a component class.
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
  const propAssignments = pageNode.props
    .map((p) => `    this.${p.name} = props.${p.name};`)
    .join('\n')

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

  // pageNode.uses may be absent on older/pre-capability ASTs (e.g.
  // anything compiled before this field existed), so default to []
  // rather than assuming every caller has been updated.
  // pageNode.uses/needs/background may each name capabilities the page
  // reads from directly (Auth.user, Theme.mode, etc.) -- substituteCapabilityRefs
  // already treats all three as the same "capability name" pool when
  // rewriting bare references to `this.<Name>`, so the getters generated
  // here must cover the same pool, not just `uses` alone, or a
  // needs-only or background-only capability resolves to undefined at
  // runtime with no compile-time signal that anything's wrong.
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
  // IMPORTANT: onMount is no longer invoked from inside the
  // constructor. Pages that declare `needs` capabilities must have
  // those capabilities' async init() fully resolved (via __ready())
  // before onMount runs, or onMount's own logic (e.g. redirecting
  // based on Auth.user) races against that resolution and reads
  // stale/uninitialized capability state. The caller (renderPageDocument.js)
  // is responsible for awaiting __ready() and then calling __onMount()
  // explicitly, in that order.
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
${propAssignments ? propAssignments + '\n' : ''}    this.__state = reactive({
${stateInit}
    });
${backgroundResolution ? backgroundResolution + '\n' : ''}  }

${[stateAccessors, usesAccessors, computedGetters, actionMethods, readyMethod, onMountMethod].filter(Boolean).join('\n\n')}
}`
}

// Local import kept separate from generateMethod's own statement
// formatting so computed getters and state accessors can share the
// same statement codegen without generateMethod's parameter handling.
import { generateStatement } from './generateStatement.js'
function statementSource(stmt) {
  return generateStatement(stmt)
}
