import { EventEmitter } from 'node:events'

// One process only: the fastest driver, but other processes (workers,
// "tylix channels:work") neither see its values nor its messages.
export function createMemoryStore() {
  const values = new Map()
  const events = new EventEmitter()
  events.setMaxListeners(0)

  const live = (key) => {
    const entry = values.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      values.delete(key)
      return null
    }
    return entry
  }

  // Expired entries nobody reads again are swept once a minute.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of values) if (entry.expiresAt !== null && entry.expiresAt <= now) values.delete(key)
  }, 60_000)
  sweep.unref()

  return {
    driver: 'memory',
    shared: false,
    async get(key) {
      return live(key)?.value ?? null
    },
    async set(key, value, { ttlMs } = {}) {
      values.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null })
    },
    async delete(key) {
      values.delete(key)
    },
    async deletePrefix(prefix) {
      let count = 0
      for (const key of [...values.keys()]) {
        if (key.startsWith(prefix)) {
          values.delete(key)
          count++
        }
      }
      return count
    },
    async increment(key, { by = 1, ttlMs } = {}) {
      const entry = live(key)
      if (entry) {
        entry.value = Number(entry.value) + by
        return entry.value
      }
      values.set(key, { value: by, expiresAt: ttlMs ? Date.now() + ttlMs : null })
      return by
    },
    async publish(channel, message) {
      // Asynchronous, like the shared drivers, so code doesn't come to rely
      // on a subscriber running before publish() returns.
      setImmediate(() => events.emit(channel, message))
    },
    async subscribe(channel, listener) {
      events.on(channel, listener)
      return async () => events.off(channel, listener)
    },
    async close() {
      clearInterval(sweep)
      events.removeAllListeners()
    },
  }
}
