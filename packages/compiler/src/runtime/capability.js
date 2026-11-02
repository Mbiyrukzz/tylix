// Capability registry: singleton, framework-managed state/action
// bundles that pages access via `uses` (see generatePage.js's
// usesAccessors, which call resolveCapability(name) as a getter).
// One instance per capability name, shared across every page in the
// app -- resolveCapability memoizes on first resolution rather than
// re-running the def.
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
  registry.set(name, {
    def,
    instance: null,
    initStarted: false,
    initPromise: null,
  })
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
    const instance = reactive({ ...entry.def.state })
    Object.assign(instance, bindActions(entry.def.actions, instance))
    // Exposed so pages can `await Auth.ready()` before making a
    // redirect decision. Defined once, here, so resolving does not
    // keep writing to reactive state.
    instance.ready = () => entry.initPromise ?? Promise.resolve()
    entry.instance = instance
  }

  // init() runs exactly once, whether it is async or not.
  if (!entry.initStarted) {
    entry.initStarted = true
    if (entry.def.init) {
      try {
        entry.initPromise = Promise.resolve(
          entry.def.init.call(entry.instance),
        )
      } catch (err) {
        entry.initPromise = Promise.reject(err)
      }
      // Log here so a failed init is never an unhandled rejection;
      // ready() still rejects for anyone awaiting it.
      entry.initPromise.catch((err) => {
        console.error(`Capability "${name}" init failed:`, err)
      })
    }
  }

  return entry.instance
}