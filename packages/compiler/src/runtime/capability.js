// Capability registry: singleton, framework-managed state/action
// bundles that pages access via `uses` (see generatePage.js's
// usesAccessors, which call resolveCapability(name) as a getter).
// One instance per capability name, shared across every page in the
// app -- resolveCapability memoizes on first resolution rather than
// re-running the def, the same "resolve once, reuse forever" shape
// createResource's .load() gives resources, just app-scoped instead
// of per-page.
//
// A capability def has the shape:
//   {
//     state: { ... },              // plain object, becomes reactive()
//     actions: { name(...) {} },   // methods; `this` bound to the
//                                  // reactive instance so they can
//                                  // read/write state like a page
//                                  // action can
//     async init() { ... },        // optional, runs once; `this`
//                                  // bound the same way
//   }

const registry = new Map()

export function defineCapability(name, def) {
  registry.set(name, { def, instance: null, initPromise: null })
}

export function bindActions(actions, instance) {
  const bound = {}
  for (const key of Object.keys(actions ?? {})) {
    bound[key] = actions[key].bind(instance)
  }
  return bound
}

export function resolveCapability(name) {
  const entry = registry.get(name)
  if (!entry) {
    throw new Error(
      `Unknown capability "${name}". Did you forget to register it with defineCapability()?`,
    )
  }

  if (!entry.instance) {
    entry.instance = reactive({ ...entry.def.state })
    Object.assign(
      entry.instance,
      bindActions(entry.def.actions, entry.instance),
    )
  }

  if (!entry.initPromise && entry.def.init) {
    entry.initPromise = entry.def.init.call(entry.instance)
  }

  // Exposed so pages can `await Auth.ready()` before making a
  // redirect decision, instead of racing the reactive `loading` flag
  // with their own onMount timing.
  entry.instance.ready = () => entry.initPromise ?? Promise.resolve()

  return entry.instance
}
