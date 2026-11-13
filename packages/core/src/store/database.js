import { ConnectionManager, MongoAdapter, MysqlAdapter, PostgresAdapter } from '@tylix/orm'

// Keeps values in the app's own database (table tylix_store), so every
// process and server using that database shares them, with nothing new to
// run. Messages go through table tylix_events, which subscribers poll
// (every 250ms by default). For heavy traffic use Redis.
//
// Tables are created on first use. On MongoDB values work, messages don't
// (use Redis).

const STORE = 'tylix_store'
const EVENTS = 'tylix_events'
const EVENT_TTL_MS = 60_000

function dialectOf(adapter) {
  if (adapter instanceof PostgresAdapter) return 'postgres'
  if (adapter instanceof MysqlAdapter) return 'mysql'
  if (adapter instanceof MongoAdapter) return 'mongo'
  return 'sqlite'
}

export function createDatabaseStore({ adapter: given, pollMs = 250 } = {}) {
  const adapter = () => given ?? ConnectionManager.getAdapter()
  let ready = null
  const q = (name) => adapter().quoteIdentifier(name)

  function setup() {
    ready ??= (async () => {
      const db = adapter()
      const dialect = dialectOf(db)
      if (dialect === 'mongo') {
        await db.db.collection(STORE).createIndex({ key: 1 }, { unique: true })
        return
      }
      const bigint = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT'
      const keyType = dialect === 'mysql' ? 'VARCHAR(255)' : 'TEXT'
      const text = dialect === 'mysql' ? 'MEDIUMTEXT' : 'TEXT'
      const increments = db.columnType('increments')
      await db.run(`CREATE TABLE IF NOT EXISTS ${q(STORE)} (${q('key')} ${keyType} PRIMARY KEY, ${q('value')} ${text}, ${q('expires_at')} ${bigint})`)
      await db.run(`CREATE TABLE IF NOT EXISTS ${q(EVENTS)} (${q('id')} ${increments}, ${q('channel')} ${keyType}, ${q('message')} ${text}, ${q('created_at')} ${bigint})`)
    })()
    return ready
  }

  const expired = (row) => row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) <= Date.now()
  const expiry = (ttlMs) => (ttlMs ? Date.now() + ttlMs : null)

  async function getRow(key) {
    await setup()
    const db = adapter()
    if (dialectOf(db) === 'mongo') return db.db.collection(STORE).findOne({ key })
    return db.get(`SELECT ${q('value')}, ${q('expires_at')} FROM ${q(STORE)} WHERE ${q('key')} = ?`, [key])
  }

  async function upsert(key, value, expiresAt) {
    await setup()
    const db = adapter()
    const dialect = dialectOf(db)
    if (dialect === 'mongo') {
      await db.db.collection(STORE).updateOne({ key }, { $set: { key, value, expires_at: expiresAt } }, { upsert: true })
      return
    }
    const params = [key, value, expiresAt]
    if (dialect === 'mysql') {
      await db.run(`INSERT INTO ${q(STORE)} (${q('key')}, ${q('value')}, ${q('expires_at')}) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ${q('value')} = VALUES(${q('value')}), ${q('expires_at')} = VALUES(${q('expires_at')})`, params)
      return
    }
    await db.get(
      `INSERT INTO ${q(STORE)} (${q('key')}, ${q('value')}, ${q('expires_at')}) VALUES (?, ?, ?) ON CONFLICT (${q('key')}) DO UPDATE SET ${q('value')} = excluded.${q('value')}, ${q('expires_at')} = excluded.${q('expires_at')} RETURNING ${q('key')}`,
      params,
    )
  }

  async function remove(key) {
    await setup()
    const db = adapter()
    if (dialectOf(db) === 'mongo') await db.db.collection(STORE).deleteOne({ key })
    else await db.run(`DELETE FROM ${q(STORE)} WHERE ${q('key')} = ?`, [key])
  }

  let published = 0
  async function prune() {
    await adapter().run(`DELETE FROM ${q(EVENTS)} WHERE ${q('created_at')} < ?`, [Date.now() - EVENT_TTL_MS])
  }

  const subscriptions = new Map() // channel -> Set(listener)
  let poller = null
  let lastId = null

  async function poll() {
    const db = adapter()
    if (lastId === null) {
      const row = await db.get(`SELECT MAX(${q('id')}) AS ${q('last')} FROM ${q(EVENTS)}`)
      lastId = Number(row?.last ?? 0)
      return
    }
    const rows = await db.all(`SELECT ${q('id')}, ${q('channel')}, ${q('message')} FROM ${q(EVENTS)} WHERE ${q('id')} > ? ORDER BY ${q('id')} LIMIT 500`, [lastId])
    for (const row of rows) {
      lastId = Number(row.id)
      const listeners = subscriptions.get(row.channel)
      if (!listeners) continue
      const message = JSON.parse(row.message)
      for (const listener of listeners) listener(message)
    }
  }

  return {
    driver: 'database',
    shared: true,
    async get(key) {
      const row = await getRow(key)
      if (!row) return null
      if (expired(row)) {
        await remove(key)
        return null
      }
      return JSON.parse(row.value)
    },
    async set(key, value, { ttlMs } = {}) {
      await upsert(key, JSON.stringify(value), expiry(ttlMs))
    },
    delete: remove,
    async deletePrefix(prefix) {
      await setup()
      const db = adapter()
      if (dialectOf(db) === 'mongo') {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return (await db.db.collection(STORE).deleteMany({ key: { $regex: `^${escaped}` } })).deletedCount
      }
      // "!" escapes LIKE wildcards: a backslash would itself need escaping on MySQL.
      const pattern = prefix.replace(/[!%_]/g, (c) => `!${c}`) + '%'
      const result = await db.run(`DELETE FROM ${q(STORE)} WHERE ${q('key')} LIKE ? ESCAPE '!'`, [pattern])
      return Number(result?.changes ?? result?.rowCount ?? result?.affectedRows ?? 0)
    },
    // One statement per call, so concurrent increments from any number of
    // processes are counted exactly (MySQL and MongoDB: the returned value
    // can be off by concurrent increments, the stored count is exact).
    async increment(key, { by = 1, ttlMs } = {}) {
      await setup()
      const db = adapter()
      const dialect = dialectOf(db)
      const now = Date.now()
      const freshExpiry = expiry(ttlMs)
      if (dialect === 'mongo') {
        const collection = db.db.collection(STORE)
        await collection.deleteOne({ key, expires_at: { $ne: null, $lte: now } })
        const doc = await collection.findOneAndUpdate(
          { key },
          { $inc: { count: by }, $setOnInsert: { key, expires_at: freshExpiry } },
          { upsert: true, returnDocument: 'after' },
        )
        const count = (doc?.value ?? doc)?.count ?? by
        await collection.updateOne({ key }, { $set: { value: JSON.stringify(count) } })
        return count
      }
      const isExpired = `${q(STORE)}.${q('expires_at')} IS NOT NULL AND ${q(STORE)}.${q('expires_at')} <= ?`
      if (dialect === 'mysql') {
        await db.run(
          `INSERT INTO ${q(STORE)} (${q('key')}, ${q('value')}, ${q('expires_at')}) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ${q('value')} = IF(${q('expires_at')} IS NOT NULL AND ${q('expires_at')} <= ?, ?, CAST(${q('value')} AS SIGNED) + ?), ${q('expires_at')} = IF(${q('expires_at')} IS NOT NULL AND ${q('expires_at')} <= ?, ?, ${q('expires_at')})`,
          [key, String(by), freshExpiry, now, String(by), by, now, freshExpiry],
        )
        const row = await db.get(`SELECT ${q('value')} FROM ${q(STORE)} WHERE ${q('key')} = ?`, [key])
        return Number(row.value)
      }
      const row = await db.get(
        `INSERT INTO ${q(STORE)} (${q('key')}, ${q('value')}, ${q('expires_at')}) VALUES (?, ?, ?) ON CONFLICT (${q('key')}) DO UPDATE SET ${q('value')} = CASE WHEN ${isExpired} THEN ? ELSE CAST(CAST(${q(STORE)}.${q('value')} AS INTEGER) + CAST(? AS INTEGER) AS TEXT) END, ${q('expires_at')} = CASE WHEN ${isExpired} THEN ? ELSE ${q(STORE)}.${q('expires_at')} END RETURNING ${q('value')}`,
        [key, String(by), freshExpiry, now, String(by), by, now, freshExpiry],
      )
      return Number(row.value)
    },
    async publish(channel, message) {
      await setup()
      const db = adapter()
      if (dialectOf(db) === 'mongo') throw new Error('The database store cannot send messages on MongoDB. Use STORE_DRIVER=redis.')
      await db.run(`INSERT INTO ${q(EVENTS)} (${q('channel')}, ${q('message')}, ${q('created_at')}) VALUES (?, ?, ?)`, [channel, JSON.stringify(message), Date.now()])
      if (++published % 100 === 0) await prune()
    },
    async subscribe(channel, listener) {
      await setup()
      if (dialectOf(adapter()) === 'mongo') throw new Error('The database store cannot receive messages on MongoDB. Use STORE_DRIVER=redis.')
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set())
      subscriptions.get(channel).add(listener)
      if (!poller) {
        await poll() // start from the newest message: only new ones arrive
        let polling = false
        poller = setInterval(async () => {
          if (polling) return
          polling = true
          try {
            await poll()
          } catch {
            // the database is briefly unavailable: try again next tick
          } finally {
            polling = false
          }
        }, pollMs)
        poller.unref()
      }
      return async () => {
        subscriptions.get(channel)?.delete(listener)
      }
    },
    async close() {
      clearInterval(poller)
      poller = null
      subscriptions.clear()
    },
  }
}
