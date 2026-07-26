import { CacheRecord } from './CacheRecord.js'

function isExpired(row) {
  if (!row.expires_at) return false
  return new Date(row.expires_at).getTime() <= Date.now()
}

export const cache = {
  // ttlSeconds omitted or null = never expires
  async set(key, value, ttlSeconds = null) {
    const serialized = JSON.stringify(value)
    const expiresAt =
      ttlSeconds !== null
        ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
        : null

    const existing = await CacheRecord.query().where('key', key).first()

    if (existing) {
      return CacheRecord.update(existing.id, {
        value: serialized,
        expires_at: expiresAt,
      })
    }
    return CacheRecord.create({ key, value: serialized, expires_at: expiresAt })
  },

  async get(key) {
    const row = await CacheRecord.query().where('key', key).first()
    if (!row) return null

    if (isExpired(row)) {
      await CacheRecord.delete(row.id)
      return null
    }

    return JSON.parse(row.value)
  },

  async has(key) {
    const row = await CacheRecord.query().where('key', key).first()
    if (!row) return false
    if (isExpired(row)) {
      await CacheRecord.delete(row.id)
      return false
    }
    return true
  },

  async forget(key) {
    const row = await CacheRecord.query().where('key', key).first()
    if (row) await CacheRecord.delete(row.id)
    return true
  },

  // Clears everything, or -- if a prefix is given -- only keys
  // starting with it (e.g. cache.clear('user:') to drop all
  // per-user cache entries without wiping the whole table).
  async clear(prefix = null) {
    if (prefix === null) {
      const all = await CacheRecord.all()
      for (const row of all) {
        await CacheRecord.delete(row.id)
      }
      return all.length
    }

    const all = await CacheRecord.all()
    const matching = all.filter((row) => row.key.startsWith(prefix))
    for (const row of matching) {
      await CacheRecord.delete(row.id)
    }
    return matching.length
  },
}
