import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteAdapter } from '@tylix/orm'
import { createStore, setStore } from './index.js'
import { createRedisStore } from './redis.js'
import { cache } from '../cache/Cache.js'
import { createRateLimiter } from '../http/rateLimit.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// The same checks for every driver.
async function behaves(store, label) {
  assert.equal(await store.get('missing'), null, label)
  await store.set('user:1', { name: 'Ada' })
  assert.deepEqual(await store.get('user:1'), { name: 'Ada' }, label)
  await store.set('short', 1, { ttlMs: 30 })
  assert.equal(await store.get('short'), 1, label)
  await wait(50)
  assert.equal(await store.get('short'), null, `${label}: expired`)
  assert.equal(await store.increment('hits', { ttlMs: 60_000 }), 1, label)
  assert.equal(await store.increment('hits', { by: 4 }), 5, label)
  assert.equal(await store.increment('brief', { ttlMs: 30 }), 1, label)
  await wait(50)
  assert.equal(await store.increment('brief', { ttlMs: 30 }), 1, `${label}: an expired counter starts again`)
  await store.set('user:2', 2)
  await store.set('user_x', 3) // "_" is not a wildcard
  assert.equal(await store.deletePrefix('user:'), 2, label)
  assert.deepEqual(await store.get('user_x'), 3, label)
  await store.delete('user_x')
  assert.equal(await store.get('user_x'), null, label)
}

test('memory store', async () => {
  const store = await createStore({ driver: 'memory' })
  await behaves(store, 'memory')
  const got = []
  const stop = await store.subscribe('news', (m) => got.push(m))
  await store.publish('news', { a: 1 })
  await wait(5)
  await stop()
  await store.publish('news', { a: 2 })
  await wait(5)
  assert.deepEqual(got, [{ a: 1 }])
  await store.close()
})

test('database store: values and messages shared between connections, as between processes', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-store-')), 'app.sqlite')
  const one = await new SqliteAdapter({ filename: file }).connect()
  const two = await new SqliteAdapter({ filename: file }).connect()
  const a = await createStore({ driver: 'database', adapter: one, pollMs: 20, prefix: 'app:' })
  const b = await createStore({ driver: 'database', adapter: two, pollMs: 20, prefix: 'app:' })
  await behaves(a, 'database')
  await a.set('shared', 'yes')
  assert.equal(await b.get('shared'), 'yes')
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).increment('together')))
  assert.equal(await a.increment('together', { by: 0 }), 20, 'concurrent increments all counted')

  const got = []
  await b.subscribe('chat', (m) => got.push(m))
  await a.publish('chat', { text: 'hello' })
  await a.publish('other', { text: 'not for b' })
  for (let i = 0; i < 50 && got.length === 0; i++) await wait(20)
  assert.deepEqual(got, [{ text: 'hello' }])
  await a.close()
  await b.close()
  await one.close()
  await two.close()
})

// A stand-in with node-redis's methods, so the driver's logic runs without
// a Redis server. (Not a substitute for testing against real Redis.)
function fakeRedis() {
  const data = new Map()
  const expires = new Map()
  const subs = new Map()
  const alive = (k) => {
    if (expires.has(k) && expires.get(k) <= Date.now()) {
      data.delete(k)
      expires.delete(k)
    }
    return data.has(k)
  }
  const client = {
    async get(k) {
      return alive(k) ? data.get(k) : null
    },
    async set(k, v, opts) {
      data.set(k, v)
      if (opts?.PX) expires.set(k, Date.now() + opts.PX)
      else expires.delete(k)
    },
    async del(keys) {
      let n = 0
      for (const k of [].concat(keys)) if (data.delete(k)) n++
      return n
    },
    async *scanIterator({ MATCH }) {
      const prefix = MATCH.slice(0, -1).replace(/\\(.)/g, '$1')
      yield [...data.keys()].filter((k) => alive(k) && k.startsWith(prefix))
    },
    async eval(script, { keys: [k], arguments: [by, ttl] }) {
      const value = (alive(k) ? Number(data.get(k)) : 0) + Number(by)
      data.set(k, String(value))
      if (Number(ttl) > 0 && !expires.has(k)) expires.set(k, Date.now() + Number(ttl))
      return value
    },
    async publish(channel, raw) {
      for (const fn of subs.get(channel) ?? []) setImmediate(fn, raw)
    },
    duplicate: () => ({
      connect: async () => {},
      subscribe: async (channel, fn) => subs.set(channel, [...(subs.get(channel) ?? []), fn]),
      unsubscribe: async () => {},
      quit: async () => {},
    }),
  }
  return client
}

test('redis store (against a stand-in client)', async () => {
  const store = await createRedisStore({ client: fakeRedis() })
  await behaves(store, 'redis')
  const got = []
  await store.subscribe('chat', (m) => got.push(m))
  await store.publish('chat', { hi: true })
  await wait(5)
  assert.deepEqual(got, [{ hi: true }])
})

test('cache on the store: remember computes once, even for concurrent callers', async () => {
  setStore(await createStore({ driver: 'memory' }))
  let calls = 0
  const compute = async () => {
    calls++
    await wait(10)
    return { n: 42 }
  }
  const results = await Promise.all([cache.remember('k', 60, compute), cache.remember('k', 60, compute)])
  assert.deepEqual(results, [{ n: 42 }, { n: 42 }])
  assert.deepEqual(await cache.remember('k', 60, compute), { n: 42 })
  assert.equal(calls, 1)
  await cache.set('user:1', 'a')
  await cache.set('user:2', 'b')
  assert.equal(await cache.clear('user:'), 2)
  assert.equal(await cache.has('k'), true)
  await cache.forget('k')
  assert.equal(await cache.get('k'), null)
})

test('shared rate limiter counts across limiter instances (as across workers)', async () => {
  setStore(await createStore({ driver: 'memory' }))
  const workerA = createRateLimiter({ name: 'login', max: 3, windowMs: 60_000, store: 'shared' })
  const workerB = createRateLimiter({ name: 'login', max: 3, windowMs: 60_000, store: 'shared' })
  const results = [await workerA('1.2.3.4'), await workerB('1.2.3.4'), await workerA('1.2.3.4'), await workerB('1.2.3.4')]
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false])
  assert.ok(results[3].retryAfterSeconds >= 1)
  assert.equal((await workerA('5.6.7.8')).allowed, true, 'other keys are counted apart')
  assert.throws(() => createRateLimiter({ max: 1, windowMs: 1, store: 'shared' }), /needs a name/)
  const local = createRateLimiter({ max: 1, windowMs: 60_000 })
  assert.equal(local('x').allowed, true, 'the default stays synchronous')
  assert.equal(local('x').allowed, false)
})
