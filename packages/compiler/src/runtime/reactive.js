/**
 * Minimal fine-grained reactivity core (Proxy get/set + dependency
 * tracking), the same fundamental technique Vue 3 and Solid use to
 * avoid virtual-DOM diffing entirely. An effect() records which
 * reactive properties it read; reactive() re-runs exactly the effects
 * that depend on a property when that property is written -- nothing
 * else re-renders.
 *
 * What is wrapped: plain objects and arrays, lazily on read and
 * memoized (so repeated reads return the same Proxy identity). Date,
 * Map, Set, Promise, RegExp, DOM nodes and class instances are left
 * alone: their methods need the real object as `this` and break when
 * called through a Proxy.
 *
 * What is tracked: property reads, `key in obj`, and key enumeration
 * (Object.keys, for...in). Writes that ADD a key also notify readers
 * of the array's length / the object's key list, which is what makes
 * `items.push(x)` re-render a list that iterates `items`.
 *
 * Every effect tracks (a) which dep Sets it's currently a member of,
 * and (b) which child effects were created while it was running
 * (e.g. an #if/#each block's effect re-creating its children's own
 * effects on every rebuild). Before an effect re-runs, it detaches
 * from every dep and deactivates every child, recursively. A
 * deactivated effect is skipped even if it is already queued in the
 * current trigger pass, so a replaced block can never fire against
 * DOM nodes that were already removed.
 */

let activeEffect = null
const targetMap = new WeakMap()

// target -> proxy, so re-reading the same nested object returns the
// same Proxy instance (dependencies tracked against one wrapper must
// match the wrapper read on later passes).
const reactiveMap = new WeakMap()
// Every proxy we have handed out, to avoid double-wrapping.
const proxies = new WeakSet()

const ITERATE_KEY = Symbol('iterate')

function isReactiveTarget(val) {
  if (val === null || typeof val !== 'object') return false
  if (proxies.has(val)) return true
  if (Object.isFrozen(val)) return false
  if (Array.isArray(val)) return true
  const proto = Object.getPrototypeOf(val)
  return proto === Object.prototype || proto === null
}

function isIndexKey(key) {
  return typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
}

export function reactive(target) {
  if (!isReactiveTarget(target)) return target
  if (proxies.has(target)) return target
  const existing = reactiveMap.get(target)
  if (existing) return existing

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      const result = Reflect.get(obj, key, receiver)
      if (typeof key !== 'symbol') track(obj, key)
      // Lazily wrap nested plain objects/arrays so writes to THEIR
      // properties are tracked too.
      return isReactiveTarget(result) ? reactive(result) : result
    },
    has(obj, key) {
      if (typeof key !== 'symbol') track(obj, key)
      return Reflect.has(obj, key)
    },
    ownKeys(obj) {
      track(obj, Array.isArray(obj) ? 'length' : ITERATE_KEY)
      return Reflect.ownKeys(obj)
    },
    set(obj, key, value, receiver) {
      const isArray = Array.isArray(obj)
      const hadKey =
        isArray && isIndexKey(key)
          ? Number(key) < obj.length
          : Object.prototype.hasOwnProperty.call(obj, key)
      const oldValue = obj[key]
      const result = Reflect.set(obj, key, value, receiver)
      if (!hadKey) {
        trigger(obj, key, 'add')
      } else if (!Object.is(oldValue, value)) {
        trigger(obj, key, 'set', isArray && key === 'length' ? value : undefined)
      }
      return result
    },
    deleteProperty(obj, key) {
      const hadKey = Object.prototype.hasOwnProperty.call(obj, key)
      const result = Reflect.deleteProperty(obj, key)
      if (hadKey && result) trigger(obj, key, 'delete')
      return result
    },
  })

  reactiveMap.set(target, proxy)
  proxies.add(proxy)
  return proxy
}

function track(obj, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(obj)
  if (!depsMap) targetMap.set(obj, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
  }
}

function trigger(obj, key, type, newLength) {
  const depsMap = targetMap.get(obj)
  if (!depsMap) return

  const queued = new Set()
  const collect = (dep) => {
    if (dep) for (const fn of dep) queued.add(fn)
  }

  collect(depsMap.get(key))

  if (type === 'add') {
    if (Array.isArray(obj)) {
      if (isIndexKey(key)) collect(depsMap.get('length'))
    } else {
      collect(depsMap.get(ITERATE_KEY))
    }
  } else if (type === 'delete' && !Array.isArray(obj)) {
    collect(depsMap.get(ITERATE_KEY))
  }

  // `arr.length = 0` / splice shrinking: readers of the removed
  // indices must hear about it too.
  if (Array.isArray(obj) && key === 'length' && newLength !== undefined) {
    for (const [k, dep] of depsMap) {
      if (isIndexKey(k) && Number(k) >= newLength) collect(dep)
    }
  }

  // Run every queued effect even if one throws, then rethrow the
  // first error so a failing effect can't starve the others.
  let failed = false
  let firstError
  for (const fn of queued) {
    if (!fn.active || fn === activeEffect) continue
    try {
      fn()
    } catch (err) {
      if (!failed) {
        failed = true
        firstError = err
      }
    }
  }
  if (failed) throw firstError
}

// Detaches an effect from every dep Set it was part of and
// deactivates every child effect it created during its last run --
// recursively, so a deeply nested #if inside an #each inside another
// #if tears down its whole subtree.
function cleanup(effectFn) {
  for (const dep of effectFn.deps) dep.delete(effectFn)
  effectFn.deps.length = 0
  for (const child of effectFn.children) {
    child.active = false
    cleanup(child)
  }
  effectFn.children.length = 0
}

export function effect(fn) {
  const wrapped = () => {
    if (!wrapped.active) return
    cleanup(wrapped)
    const previousEffect = activeEffect
    // Register as a child of whichever effect is currently running
    // (if any), so that when THAT effect re-runs, it disposes this
    // one too.
    if (previousEffect) previousEffect.children.push(wrapped)
    activeEffect = wrapped
    try {
      fn()
    } finally {
      activeEffect = previousEffect
    }
  }
  wrapped.active = true
  wrapped.deps = []
  wrapped.children = []
  wrapped()
  return wrapped
}