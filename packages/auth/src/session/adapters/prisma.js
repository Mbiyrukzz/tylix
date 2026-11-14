// Sessions through Prisma. Add this model to schema.prisma:
//
//   model AuthSession {
//     id            String   @id
//     userId        String
//     tokenHash     String
//     prevTokenHash String?
//     rotatedAt     BigInt?
//     createdAt     BigInt
//     lastUsedAt    BigInt
//     expiresAt     BigInt
//     idleExpiresAt BigInt?
//     persistent    Boolean
//     ip            String?
//     userAgent     String?
//     data          String?
//     @@index([userId])
//   }
//
//   prismaAdapter(prisma.authSession)

const FIELDS = ['tokenHash', 'prevTokenHash', 'rotatedAt', 'lastUsedAt', 'idleExpiresAt', 'expiresAt', 'data', 'ip', 'userAgent']
const TIMES = ['rotatedAt', 'createdAt', 'lastUsedAt', 'expiresAt', 'idleExpiresAt']

export function prismaAdapter(delegate) {
  if (!delegate || typeof delegate.findUnique !== 'function') throw new TypeError('prismaAdapter needs a Prisma model delegate, e.g. prisma.authSession')

  const toDb = (record) => {
    const out = { ...record, userId: String(record.userId) }
    for (const k of TIMES) if (out[k] != null) out[k] = BigInt(out[k])
    if ('data' in out) out.data = out.data == null ? null : JSON.stringify(out.data)
    return out
  }
  const fromDb = (row) => {
    if (!row) return null
    const out = { ...row }
    for (const k of TIMES) if (out[k] != null) out[k] = Number(out[k])
    out.data = row.data == null ? null : JSON.parse(row.data)
    return out
  }

  return {
    async create(record) {
      await delegate.create({ data: toDb(record) })
    },
    async get(id) {
      return fromDb(await delegate.findUnique({ where: { id } }))
    },
    async update(id, patch, { expectTokenHash } = {}) {
      const data = toDb(Object.fromEntries(Object.entries(patch).filter(([k]) => FIELDS.includes(k))))
      delete data.userId
      const where = expectTokenHash === undefined ? { id } : { id, tokenHash: expectTokenHash }
      const { count } = await delegate.updateMany({ where, data })
      return count === 1
    },
    async delete(id) {
      await delegate.deleteMany({ where: { id } })
    },
    async deleteByUser(userId, { exceptId } = {}) {
      const where = { userId: String(userId), ...(exceptId ? { NOT: { id: exceptId } } : {}) }
      return (await delegate.deleteMany({ where })).count
    },
    async listByUser(userId) {
      return (await delegate.findMany({ where: { userId: String(userId) } })).map(fromDb)
    },
  }
}
