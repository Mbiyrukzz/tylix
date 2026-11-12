/**
 * Minimal fine-grained reactivity core (Proxy get/set + dependency
 * tracking), the same fundamental technique Vue 3 and Solid use to
 * avoid virtual-DOM diffing entirely. An effect() records which
 * reactive properties it read; reactive() re-runs exactly the effects
 * that depend on a property when that property is written -- nothing
 * else re-renders.
 *
 * What is wrapped: plain objects, arrays, Map, Set and Date, lazily
 * on read and memoized (so repeated reads return the same Proxy
 * identity). Promise, RegExp, DOM nodes and other class instances are
 * left alone: their methods need the real object as `this` and break
 * when called through a Proxy.
 *
 * Map and Set: get/has/set/add/delete/clear, size, forEach and
 * iteration are instrumented. Reads of a key re-run when that key is
 * added, changed or removed; size and iteration re-run when entries
 * are added, removed (or, for a Map, changed).
 *
 * Date: every read method (getDate, toLocaleDateString, ...) is
 * tracked, and every setter (setDate, setHours, ...) re-runs readers
 * when it actually changes the time value.
 *
 * What is tracked on plain objects: property reads, `key in obj`, and
 * key enumeration (Object.keys, for...in). Writes that ADD a key also
 * notify readers of the array's length / the object's key list, which
 * is what makes `items.push(x)` re-render a list that iterates
 * `items`.
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
// proxy -> original object, so a Map/Set key or value that is already
// a proxy can still be looked up by its original.
const proxyToRaw = new WeakMap()

const ITERATE_KEY = Symbol('iterate')
const DATE_KEY = Symbol('date')

function collectionKind(val) {
  const proto = Object.getPrototypeOf(val)
  if (proto === Map.prototype) return 'map'
  if (proto === Set.prototype) return 'set'
  if (proto === Date.prototype) return 'date'
  return null
}

function isReactiveTarget(val) {
  if (val === null || typeof val !== 'object') return false
  if (proxies.has(val)) return true
  if (Object.isFrozen(val)) return false
  if (Array.isArray(val)) return true
  const proto = Object.getPrototypeOf(val)
  return (
    proto === Object.prototype || proto === null || collectionKind(val) !== null
  )
}

function isIndexKey(key) {
  return typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
}

// Returns the original object behind a reactive proxy (or the value
// itself when it is not a proxy).
export function toRaw(value) {
  return proxyToRaw.get(value) ?? value
}

function wrapValue(value) {
  return isReactiveTarget(value) ? reactive(value) : value
}

// ---- plain objects and arrays ----

const objectHandler = {
  get(obj, key, receiver) {
    const result = Reflect.get(obj, key, receiver)
    if (typeof key !== 'symbol') track(obj, key)
    // Lazily wrap nested reactive targets so writes to THEIR
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
}

// ---- Map and Set ----

function makeIterator(inner, wrap) {
  return {
    next() {
      const step = inner.next()
      return step.done ? step : { value: wrap(step.value), done: false }
    },
    [Symbol.iterator]() {
      return this
    },
  }
}

const wrapEntry = (entry) => [wrapValue(entry[0]), wrapValue(entry[1])]

// Each method receives (rawTarget, proxy, ...args).
const mapMethods = {
  get(obj, self, key) {
    key = toRaw(key)
    track(obj, key)
    return wrapValue(obj.get(key))
  },
  has(obj, self, key) {
    key = toRaw(key)
    track(obj, key)
    return obj.has(key)
  },
  set(obj, self, key, value) {
    key = toRaw(key)
    value = toRaw(value)
    const had = obj.has(key)
    const old = obj.get(key)
    obj.set(key, value)
    if (!had) trigger(obj, key, 'add')
    else if (!Object.is(old, value)) trigger(obj, key, 'set')
    return self
  },
  delete(obj, self, key) {
    key = toRaw(key)
    const had = obj.has(key)
    const result = obj.delete(key)
    if (had) trigger(obj, key, 'delete')
    return result
  },
  clear(obj) {
    const had = obj.size > 0
    obj.clear()
    if (had) trigger(obj, undefined, 'clear')
  },
  forEach(obj, self, callback, thisArg) {
    track(obj, ITERATE_KEY)
    obj.forEach((v, k) =>
      callback.call(thisArg, wrapValue(v), wrapValue(k), self),
    )
  },
  keys(obj) {
    track(obj, ITERATE_KEY)
    return makeIterator(obj.keys(), wrapValue)
  },
  values(obj) {
    track(obj, ITERATE_KEY)
    return makeIterator(obj.values(), wrapValue)
  },
  entries(obj) {
    track(obj, ITERATE_KEY)
    return makeIterator(obj.entries(), wrapEntry)
  },
}
mapMethods[Symbol.iterator] = mapMethods.entries

const setMethods = {
  has(obj, self, value) {
    value = toRaw(value)
    track(obj, value)
    return obj.has(value)
  },
  add(obj, self, value) {
    value = toRaw(value)
    if (!obj.has(value)) {
      obj.add(value)
      trigger(obj, value, 'add')
    }
    return self
  },
  delete(obj, self, value) {
    value = toRaw(value)
    const had = obj.has(value)
    const result = obj.delete(value)
    if (had) trigger(obj, value, 'delete')
    return result
  },
  clear(obj) {
    const had = obj.size > 0
    obj.clear()
    if (had) trigger(obj, undefined, 'clear')
  },
  forEach(obj, self, callback, thisArg) {
    track(obj, ITERATE_KEY)
    obj.forEach((v) => {
      const wrapped = wrapValue(v)
      callback.call(thisArg, wrapped, wrapped, self)
    })
  },
  values(obj) {
    track(obj, ITERATE_KEY)
    return makeIterator(obj.values(), wrapValue)
  },
  entries(obj) {
    track(obj, ITERATE_KEY)
    return makeIterator(obj.entries(), wrapEntry)
  },
}
setMethods.keys = setMethods.values
setMethods[Symbol.iterator] = setMethods.values

function collectionHandler(methods) {
  return {
    get(obj, key, receiver) {
      if (key === 'size') {
        track(obj, ITERATE_KEY)
        return obj.size
      }
      if (Object.prototype.hasOwnProperty.call(methods, key)) {
        const method = methods[key]
        return (...args) => method(obj, receiver, ...args)
      }
      const result = Reflect.get(obj, key, obj)
      return typeof result === 'function' && key !== 'constructor'
        ? result.bind(obj)
        : result
    },
  }
}

const mapHandler = collectionHandler(mapMethods)
const setHandler = collectionHandler(setMethods)

// ---- Date ----

const dateHandler = {
  get(obj, key, receiver) {
    const result = Reflect.get(obj, key, obj)
    if (typeof result !== 'function' || key === 'constructor') return result
    const isSetter = typeof key === 'string' && key.startsWith('set')
    return (...args) => {
      if (isSetter) {
        const before = obj.getTime()
        const out = result.apply(obj, args)
        if (!Object.is(before, obj.getTime())) trigger(obj, DATE_KEY, 'set')
        return out
      }
      track(obj, DATE_KEY)
      return result.apply(obj, args)
    }
  },
}

export function reactive(target) {
  if (!isReactiveTarget(target)) return target
  if (proxies.has(target)) return target
  const existing = reactiveMap.get(target)
  if (existing) return existing

  const kind = collectionKind(target)
  const handler =
    kind === 'map'
      ? mapHandler
      : kind === 'set'
        ? setHandler
        : kind === 'date'
          ? dateHandler
          : objectHandler

  const proxy = new Proxy(target, handler)
  reactiveMap.set(target, proxy)
  proxies.add(proxy)
  proxyToRaw.set(proxy, target)
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

  if (type === 'clear') {
    // Map/Set cleared: every reader of any key or of the contents.
    for (const dep of depsMap.values()) collect(dep)
  } else {
    collect(depsMap.get(key))

    if (type === 'add') {
      if (Array.isArray(obj)) {
        if (isIndexKey(key)) collect(depsMap.get('length'))
      } else {
        collect(depsMap.get(ITERATE_KEY))
      }
    } else if (type === 'delete' && !Array.isArray(obj)) {
      collect(depsMap.get(ITERATE_KEY))
    } else if (type === 'set' && obj instanceof Map) {
      // values() / entries() / forEach() readers see the new value.
      collect(depsMap.get(ITERATE_KEY))
    }

    // `arr.length = 0` / splice shrinking: readers of the removed
    // indices must hear about it too.
    if (Array.isArray(obj) && key === 'length' && newLength !== undefined) {
      for (const [k, dep] of depsMap) {
        if (isIndexKey(k) && Number(k) >= newLength) collect(dep)
      }
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

// Runs fn with dependency tracking switched off, then restores it.
// Reads inside fn do NOT subscribe whichever effect happens to be
// running, which is what you want for one-off setup code that gets
// triggered from inside a render effect (capability init()).
export function untracked(fn) {
  const previousEffect = activeEffect
  activeEffect = null
  try {
    return fn()
  } finally {
    activeEffect = previousEffect
  }
}