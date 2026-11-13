import { getStore } from '../store/index.js'

// The app cache, kept in the app's store (STORE_DRIVER), so every worker
// and server shares it.
//
//   const stats = await cache.remember('stats:home', 60, () => computeStats())
//   await cache.forget('stats:home')
//   await cache.clear('user:')            // every key starting with user:
//
// Values are stored as JSON. null means "not cached", so caching null
// has no effect.

const key = (name) => `cache:${name}`
const ttl = (seconds) => (seconds ? { ttlMs: seconds * 1000 } : {})

// remember() calls already computing a key in this process; the others
// wait for that result instead of computing it again.
const computing = new Map()

export const cache = {
  // ttlSeconds omitted or null = never expires
  async set(name, value, ttlSeconds = null) {
    await getStore().set(key(name), value, ttl(ttlSeconds))
    return value
  },

  async get(name) {
    return getStore().get(key(name))
  },

  async has(name) {
    return (await getStore().get(key(name))) !== null
  },

  async forget(name) {
    await getStore().delete(key(name))
    return true
  },

  // Clears everything, or -- if a prefix is given -- only keys starting
  // with it (cache.clear('user:') drops every per-user entry).
  async clear(prefix = '') {
    return getStore().deletePrefix(key(prefix ?? ''))
  },

  // The cached value, or compute() it, cache it and return it.
  async remember(name, ttlSeconds, compute) {
    const hit = await cache.get(name)
    if (hit !== null) return hit
    if (computing.has(name)) return computing.get(name)
    const pending = (async () => {
      try {
        const value = await compute()
        if (value !== null && value !== undefined) await cache.set(name, value, ttlSeconds)
        return value
      } finally {
        computing.delete(name)
      }
    })()
    computing.set(name, pending)
    return pending
  },
}
