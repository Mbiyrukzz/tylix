/**
 * Minimal fine-grained reactivity core (Proxy get/set + dependency
 * tracking), the same fundamental technique Vue 3 and Solid use to
 * avoid virtual-DOM diffing entirely. An effect() records which
 * reactive properties it read; reactive() re-runs exactly the effects
 * that depend on a property when that property is written -- nothing
 * else re-renders.
 *
 * Every effect also tracks (a) which dep Sets it's currently a member
 * of, and (b) which child effects were created while it was running
 * (e.g. an #if/#each block's effect re-creating its children's own
 * effects on every rebuild). Before an effect re-runs, it disposes
 * itself from every dep Set and recursively disposes every child --
 * without this, rebuilding a block's children on every re-render
 * leaks the PREVIOUS render's child effects forever: they stay
 * subscribed, keep firing on every future write to whatever they
 * read, and do so against DOM nodes that have already been removed
 * (whose .parentNode is now null), which throws and can abort
 * whatever action triggered the write mid-way through.
 */

let activeEffect = null
const targetMap = new WeakMap()

export function reactive(target) {
  return new Proxy(target, {
    get(obj, key, receiver) {
      track(obj, key)
      return Reflect.get(obj, key, receiver)
    },
    set(obj, key, value, receiver) {
      const changed = obj[key] !== value
      const result = Reflect.set(obj, key, value, receiver)
      if (changed) trigger(obj, key)
      return result
    },
  })
}

function track(obj, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(obj)
  if (!depsMap) targetMap.set(obj, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
  activeEffect.deps.push(dep)
}

function trigger(obj, key) {
  const depsMap = targetMap.get(obj)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  // Copy before iterating: an effect may re-track (add/remove itself)
  // while running, which would corrupt the Set mid-iteration.
  ;[...dep].forEach((fn) => fn())
}

// Detaches an effect from every dep Set it was previously part of,
// and disposes every child effect it created during its last run --
// disposal recurses, so a deeply nested #if inside an #each inside
// another #if tears down its whole subtree correctly.
function cleanup(effectFn) {
  for (const dep of effectFn.deps) dep.delete(effectFn)
  effectFn.deps.length = 0
  for (const child of effectFn.children) cleanup(child)
  effectFn.children.length = 0
}

export function effect(fn) {
  const wrapped = () => {
    cleanup(wrapped)
    const previousEffect = activeEffect
    // Register as a child of whichever effect is currently running
    // (if any), so that when THAT effect re-runs, it disposes this
    // one too -- this is what makes rebuilding an #if/#each block's
    // children safe to do repeatedly without leaking.
    if (previousEffect) previousEffect.children.push(wrapped)
    activeEffect = wrapped
    try {
      fn()
    } finally {
      activeEffect = previousEffect
    }
  }
  wrapped.deps = []
  wrapped.children = []
  wrapped()
  return wrapped
}
