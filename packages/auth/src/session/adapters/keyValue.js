// Sessions in any key-value store with expiry:
//
//   { get(key), set(key, value, { ttlMs }), delete(key) }
//
// That is the Tylix store (getStore()), and a few lines of glue for Redis,
// Upstash, Vercel KV, Cloudflare KV or Deno KV. Values are plain JSON.
//
// Rotation here is check-then-set, not atomic: two refreshes of the same
// token landing within microseconds can both rotate (the session survives
// and the grace period covers the loser). Use a SQL/Prisma/model adapter
// if you need strict compare-and-swap.
export function keyValueAdapter(store, { prefix = 'auth:' } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.delete !== 'function') {
    throw new TypeError('keyValueAdapter needs a store with get(key), set(key, value, { ttlMs }) and delete(key).')
  }
  const sessionKey = (id) => `${prefix}session:${id}`
  const userKey = (userId) => `${prefix}user:${encodeURIComponent(String(userId))}`

  const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
  const ttlOf = (record) => Math.max(1000, record.expiresAt - Date.now())

  async function readIndex(userId) {
    const ids = parse(await store.get(userKey(userId)))
    return Array.isArray(ids) ? ids : []
  }

  async function writeIndex(userId, ids, ttlMs) {
    if (ids.length === 0) await store.delete(userKey(userId))
    else await store.set(userKey(userId), JSON.stringify(ids), { ttlMs })
  }

  return {
    async create(record) {
      const ttlMs = ttlOf(record)
      await store.set(sessionKey(record.id), JSON.stringify(record), { ttlMs })
      const ids = await readIndex(record.userId)
      if (!ids.includes(record.id)) ids.push(record.id)
      // The index lives as long as the longest session could.
      await writeIndex(record.userId, ids, Math.max(ttlMs, 400 * 86400 * 1000))
    },
    async get(id) {
      const value = await store.get(sessionKey(id))
      return value == null ? null : parse(value)
    },
    async update(id, patch, { expectTokenHash } = {}) {
      const record = await this.get(id)
      if (!record) return false
      if (expectTokenHash !== undefined && record.tokenHash !== expectTokenHash) return false
      const next = { ...record, ...patch }
      await store.set(sessionKey(id), JSON.stringify(next), { ttlMs: ttlOf(next) })
      return true
    },
    async delete(id) {
      const record = await this.get(id)
      await store.delete(sessionKey(id))
      if (record) {
        const ids = (await readIndex(record.userId)).filter((x) => x !== id)
        await writeIndex(record.userId, ids, 400 * 86400 * 1000)
      }
    },
    async deleteByUser(userId, { exceptId } = {}) {
      const ids = await readIndex(userId)
      let count = 0
      for (const id of ids) {
        if (id === exceptId) continue
        await store.delete(sessionKey(id))
        count++
      }
      await writeIndex(userId, exceptId && ids.includes(exceptId) ? [exceptId] : [], 400 * 86400 * 1000)
      return count
    },
    async listByUser(userId) {
      const ids = await readIndex(userId)
      const records = []
      const live = []
      for (const id of ids) {
        const record = await this.get(id)
        if (record) {
          records.push(record)
          live.push(id)
        }
      }
      if (live.length !== ids.length) await writeIndex(userId, live, 400 * 86400 * 1000)
      return records
    },
  }
}
