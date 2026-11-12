// A minimal readable store that follows Svelte's store contract:
//   subscribe(fn) calls fn with the current value right away, then on
//   every change, and returns an unsubscribe function.
// `start(set)` runs when the first subscriber arrives and may return a
// stop function, which runs when the last one leaves.
//
// Kept here instead of importing svelte/store so this package has no
// runtime dependency on Svelte, and works the same in tests.
export function readable(initial, start) {
  let value = initial
  let stop = null
  let active = false
  const subscribers = new Set()

  // Like Svelte's own stores, a set() made while start() is still running
  // only updates the value: the new subscriber gets it once, right after.
  function set(next) {
    if (Object.is(next, value)) return
    value = next
    if (!active) return
    for (const fn of [...subscribers]) fn(value)
  }

  return {
    subscribe(fn) {
      subscribers.add(fn)
      if (subscribers.size === 1) {
        stop = start ? (start(set) ?? null) : null
        active = true
      }
      fn(value)
      return () => {
        subscribers.delete(fn)
        if (subscribers.size === 0) {
          active = false
          stop?.()
          stop = null
        }
      }
    },
    get: () => value,
  }
}

// A store that can also be set from outside (useHydrated uses it).
export function writable(initial) {
  let setter = null
  let value = initial
  const store = readable(initial, (set) => {
    setter = set
    set(value)
    return () => {
      setter = null
    }
  })
  return {
    subscribe: store.subscribe,
    set(next) {
      value = next
      setter?.(next)
    },
  }
}
