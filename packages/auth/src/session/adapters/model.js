// Sessions through a Tylix ORM model (or anything with the same static
// API: create, query().where().first()/get(), updateWhere, delete).
// The table is created by the "create_auth_sessions_table" migration
// that `tylix make:auth` writes. Times are ISO strings in the table.
//
// Rotation is a compare-and-swap through updateWhere().

const TIME_FIELDS = { rotatedAt: 'rotated_at', lastUsedAt: 'last_used_at', expiresAt: 'expires_at', idleExpiresAt: 'idle_expires_at' }
const OTHER_FIELDS = { tokenHash: 'token_hash', prevTokenHash: 'prev_token_hash', ip: 'ip', userAgent: 'user_agent' }

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString())
const ms = (value) => (value == null || value === '' ? null : new Date(value).getTime())

export function modelAdapter(Model) {
  if (!Model || typeof Model.updateWhere !== 'function' || typeof Model.query !== 'function') {
    throw new TypeError('modelAdapter needs a Tylix ORM model class (with query() and updateWhere()).')
  }

  const fromRow = (row) =>
    row && {
      id: row.sid,
      userId: row.user_id,
      tokenHash: row.token_hash,
      prevTokenHash: row.prev_token_hash ?? null,
      rotatedAt: ms(row.rotated_at),
      createdAt: ms(row.created_at) ?? Date.now(),
      lastUsedAt: ms(row.last_used_at),
      expiresAt: ms(row.expires_at),
      idleExpiresAt: ms(row.idle_expires_at),
      persistent: row.persistent === true || row.persistent === 1 || row.persistent === '1' || row.persistent === 'true',
      ip: row.ip ?? null,
      userAgent: row.user_agent ?? null,
      data: row.data == null || row.data === '' ? null : typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      _rowId: row.id,
    }

  const strip = (record) => {
    if (!record) return null
    const { _rowId, ...rest } = record
    return rest
  }

  async function findRow(id) {
    if (typeof id !== 'string' || id.length === 0) return null
    return Model.query().where('sid', id).first()
  }

  return {
    async create(record) {
      await Model.create({
        sid: record.id,
        user_id: record.userId,
        token_hash: record.tokenHash,
        prev_token_hash: record.prevTokenHash,
        rotated_at: iso(record.rotatedAt),
        last_used_at: iso(record.lastUsedAt),
        expires_at: iso(record.expiresAt),
        idle_expires_at: iso(record.idleExpiresAt),
        persistent: record.persistent ? 1 : 0,
        ip: record.ip,
        user_agent: record.userAgent,
        data: record.data == null ? null : JSON.stringify(record.data),
      })
    },
    async get(id) {
      return strip(fromRow(await findRow(id)))
    },
    async update(id, patch, { expectTokenHash } = {}) {
      const values = {}
      for (const [field, value] of Object.entries(patch)) {
        if (TIME_FIELDS[field]) values[TIME_FIELDS[field]] = iso(value)
        else if (OTHER_FIELDS[field]) values[OTHER_FIELDS[field]] = value
        else if (field === 'data') values.data = value == null ? null : JSON.stringify(value)
      }
      if (Object.keys(values).length === 0) return false
      const where = expectTokenHash === undefined ? { sid: id } : { sid: id, token_hash: expectTokenHash }
      return (await Model.updateWhere(where, values)) === 1
    },
    async delete(id) {
      const row = await findRow(id)
      if (row) await Model.delete(row.id)
    },
    async deleteByUser(userId, { exceptId } = {}) {
      const rows = await Model.query().where('user_id', userId).get()
      let count = 0
      for (const row of rows) {
        if (row.sid === exceptId) continue
        await Model.delete(row.id)
        count++
      }
      return count
    },
    async listByUser(userId) {
      return (await Model.query().where('user_id', userId).get()).map((row) => strip(fromRow(row)))
    },
  }
}
