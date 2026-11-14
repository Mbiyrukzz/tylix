// Sessions in this process's memory. For tests, scripts and single-process
// dev only: they vanish on restart and other servers can't see them.
export function memoryAdapter() {
  const sessions = new Map()
  return {
    ephemeral: true,
    async create(record) {
      sessions.set(record.id, { ...record })
    },
    async get(id) {
      const record = sessions.get(id)
      return record ? { ...record } : null
    },
    async update(id, patch, { expectTokenHash } = {}) {
      const record = sessions.get(id)
      if (!record) return false
      if (expectTokenHash !== undefined && record.tokenHash !== expectTokenHash) return false
      Object.assign(record, patch)
      return true
    },
    async delete(id) {
      sessions.delete(id)
    },
    async deleteByUser(userId, { exceptId } = {}) {
      let count = 0
      for (const [id, record] of sessions) {
        if (String(record.userId) === String(userId) && id !== exceptId) {
          sessions.delete(id)
          count++
        }
      }
      return count
    },
    async listByUser(userId) {
      return [...sessions.values()].filter((r) => String(r.userId) === String(userId)).map((r) => ({ ...r }))
    },
  }
}
