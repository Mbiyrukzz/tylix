// Sessions in a SQL table, through any driver. You pass one function that
// runs a parameterised statement and resolves rows (for SELECT) or the
// number of affected rows (for UPDATE/DELETE):
//
//   sqlAdapter({ dialect: 'postgres', query: async (sql, params) => ... })
//
// Placeholders are written for the dialect ($1 for postgres, ? otherwise).
// The table (see `createTableSql`) stores times as epoch milliseconds, so
// every database compares them the same way.
//
// Rotation is a real compare-and-swap (UPDATE ... WHERE token_hash = ?).

const COLUMNS = [
  'id', 'user_id', 'token_hash', 'prev_token_hash', 'rotated_at', 'created_at', 'last_used_at',
  'expires_at', 'idle_expires_at', 'persistent', 'ip', 'user_agent', 'data',
]

const FIELD_TO_COLUMN = {
  tokenHash: 'token_hash',
  prevTokenHash: 'prev_token_hash',
  rotatedAt: 'rotated_at',
  lastUsedAt: 'last_used_at',
  idleExpiresAt: 'idle_expires_at',
  expiresAt: 'expires_at',
  data: 'data',
  ip: 'ip',
  userAgent: 'user_agent',
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

export function createTableSql({ table = 'auth_sessions', dialect = 'postgres' } = {}) {
  const big = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT'
  const text = dialect === 'mysql' ? 'VARCHAR(255)' : 'TEXT'
  return [
    `CREATE TABLE IF NOT EXISTS ${table} (
  id ${dialect === 'mysql' ? 'VARCHAR(32)' : 'TEXT'} PRIMARY KEY,
  user_id ${text} NOT NULL,
  token_hash ${text} NOT NULL,
  prev_token_hash ${text},
  rotated_at ${big},
  created_at ${big} NOT NULL,
  last_used_at ${big} NOT NULL,
  expires_at ${big} NOT NULL,
  idle_expires_at ${big},
  persistent ${dialect === 'postgres' ? 'BOOLEAN' : 'INTEGER'} NOT NULL,
  ip ${text},
  user_agent ${dialect === 'mysql' ? 'VARCHAR(512)' : 'TEXT'},
  data TEXT
)`,
    `CREATE INDEX ${dialect === 'mysql' ? '' : 'IF NOT EXISTS '}${table}_user_id_idx ON ${table} (user_id)`,
  ]
}

export function sqlAdapter({ query, dialect = 'postgres', table = 'auth_sessions' }) {
  if (typeof query !== 'function') throw new TypeError('sqlAdapter needs query(sql, params)')
  if (!IDENTIFIER.test(table)) throw new TypeError(`Invalid table name ${JSON.stringify(table)}`)
  const ph = (n) => (dialect === 'postgres' ? `$${n}` : '?')

  const toRow = (r) => [
    r.id, String(r.userId), r.tokenHash, r.prevTokenHash ?? null, r.rotatedAt ?? null, r.createdAt, r.lastUsedAt,
    r.expiresAt, r.idleExpiresAt ?? null, dialect === 'postgres' ? Boolean(r.persistent) : r.persistent ? 1 : 0,
    r.ip ?? null, r.userAgent ?? null, r.data == null ? null : JSON.stringify(r.data),
  ]
  const num = (v) => (v == null ? null : Number(v))
  const fromRow = (row) =>
    row && {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      prevTokenHash: row.prev_token_hash ?? null,
      rotatedAt: num(row.rotated_at),
      createdAt: num(row.created_at),
      lastUsedAt: num(row.last_used_at),
      expiresAt: num(row.expires_at),
      idleExpiresAt: num(row.idle_expires_at),
      persistent: Boolean(row.persistent),
      ip: row.ip ?? null,
      userAgent: row.user_agent ?? null,
      data: row.data == null ? null : typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    }
  const rows = async (sql, params) => {
    const result = await query(sql, params)
    return Array.isArray(result) ? result : (result?.rows ?? [])
  }
  const affected = async (sql, params) => {
    const result = await query(sql, params)
    if (typeof result === 'number') return result
    return Number(result?.rowCount ?? result?.affectedRows ?? result?.changes ?? result?.[0]?.affectedRows ?? 0)
  }

  return {
    async create(record) {
      await query(`INSERT INTO ${table} (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => ph(i + 1)).join(', ')})`, toRow(record))
    },
    async get(id) {
      return fromRow((await rows(`SELECT * FROM ${table} WHERE id = ${ph(1)}`, [id]))[0]) ?? null
    },
    async update(id, patch, { expectTokenHash } = {}) {
      const sets = []
      const params = []
      for (const [field, value] of Object.entries(patch)) {
        const column = FIELD_TO_COLUMN[field]
        if (!column) continue
        params.push(field === 'data' ? (value == null ? null : JSON.stringify(value)) : value)
        sets.push(`${column} = ${ph(params.length)}`)
      }
      if (sets.length === 0) return false
      params.push(id)
      let sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ${ph(params.length)}`
      if (expectTokenHash !== undefined) {
        params.push(expectTokenHash)
        sql += ` AND token_hash = ${ph(params.length)}`
      }
      return (await affected(sql, params)) === 1
    },
    async delete(id) {
      await query(`DELETE FROM ${table} WHERE id = ${ph(1)}`, [id])
    },
    async deleteByUser(userId, { exceptId } = {}) {
      if (exceptId) return affected(`DELETE FROM ${table} WHERE user_id = ${ph(1)} AND id <> ${ph(2)}`, [String(userId), exceptId])
      return affected(`DELETE FROM ${table} WHERE user_id = ${ph(1)}`, [String(userId)])
    },
    async listByUser(userId) {
      return (await rows(`SELECT * FROM ${table} WHERE user_id = ${ph(1)}`, [String(userId)])).map(fromRow)
    },
  }
}
