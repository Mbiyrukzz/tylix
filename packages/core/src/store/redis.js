import { createRequire } from 'node:module'
import path from 'node:path'

// Redis: the fastest shared driver, for many servers and heavy traffic.
// Needs the "redis" package in the app (npm install redis) and REDIS_URL.

// INCRBY, and set the expiry only when the key has none yet, atomically.
const INCREMENT = `
local value = redis.call('INCRBY', KEYS[1], ARGV[1])
if tonumber(ARGV[2]) > 0 and redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return value`

async function loadRedis() {
  try {
    const require = createRequire(path.join(process.cwd(), 'package.json'))
    return await import(require.resolve('redis'))
  } catch {
    throw new Error('STORE_DRIVER=redis needs the "redis" package: run npm install redis')
  }
}

// `client` is for tests: anything with node-redis's methods.
export async function createRedisStore({ url, client: given } = {}) {
  let client = given
  if (!client) {
    const { createClient } = await loadRedis()
    client = createClient({ url })
    client.on('error', (err) => console.error('[tylix] Redis:', err.message))
    await client.connect()
  }
  let subscriber = null

  return {
    driver: 'redis',
    shared: true,
    client,
    async get(key) {
      const raw = await client.get(key)
      return raw === null ? null : JSON.parse(raw)
    },
    async set(key, value, { ttlMs } = {}) {
      await client.set(key, JSON.stringify(value), ttlMs ? { PX: ttlMs } : undefined)
    },
    async delete(key) {
      await client.del(key)
    },
    async deletePrefix(prefix) {
      let count = 0
      for await (const keys of client.scanIterator({ MATCH: `${prefix.replace(/[*?[\]\\]/g, '\\$&')}*`, COUNT: 500 })) {
        const batch = Array.isArray(keys) ? keys : [keys]
        if (batch.length) count += await client.del(batch)
      }
      return count
    },
    async increment(key, { by = 1, ttlMs } = {}) {
      return Number(await client.eval(INCREMENT, { keys: [key], arguments: [String(by), String(ttlMs ?? 0)] }))
    },
    async publish(channel, message) {
      await client.publish(channel, JSON.stringify(message))
    },
    async subscribe(channel, listener) {
      if (!subscriber) {
        subscriber = client.duplicate()
        await subscriber.connect()
      }
      const handler = (raw) => listener(JSON.parse(raw))
      await subscriber.subscribe(channel, handler)
      return async () => subscriber.unsubscribe(channel, handler)
    },
    async close() {
      await subscriber?.quit()
      if (!given) await client.quit()
    },
  }
}
