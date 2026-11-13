import { createMemoryStore } from './memory.js'
import { createDatabaseStore } from './database.js'
import { createRedisStore } from './redis.js'

// A key-value store with expiry, atomic counters and messages, shared by
// every process of the app (except the memory driver). Rate limits, the
// cache and channel broadcasts use it, so running several workers or
// servers behaves like one.
//
//   STORE_DRIVER=memory    this process only (fastest; one process)
//   STORE_DRIVER=database  the app's database (default; nothing new to run)
//   STORE_DRIVER=redis     Redis at REDIS_URL (npm install redis)
//
// Keys are prefixed (STORE_PREFIX, default the app name), so apps can
// share a Redis.

export async function createStore({ driver = 'database', redisUrl, prefix = '', adapter, client, pollMs } = {}) {
  let inner
  if (driver === 'memory') inner = createMemoryStore()
  else if (driver === 'database') inner = createDatabaseStore({ adapter, pollMs })
  else if (driver === 'redis') inner = await createRedisStore({ url: redisUrl, client })
  else throw new Error(`Unknown store driver "${driver}": use memory, database or redis.`)
  return withPrefix(inner, prefix)
}

function withPrefix(store, prefix) {
  if (!prefix) return store
  const k = (key) => `${prefix}${key}`
  return {
    ...store,
    get: (key) => store.get(k(key)),
    set: (key, value, options) => store.set(k(key), value, options),
    delete: (key) => store.delete(k(key)),
    deletePrefix: (start) => store.deletePrefix(k(start)),
    increment: (key, options) => store.increment(k(key), options),
    publish: (channel, message) => store.publish(k(channel), message),
    subscribe: (channel, listener) => store.subscribe(k(channel), listener),
  }
}

// The app's store, set by "tylix dev" / "tylix start" (and the workers)
// from the settings. Until then: a memory store.
let current = null

export function setStore(store) {
  current = store
}

export function getStore() {
  current ??= createMemoryStore()
  return current
}
