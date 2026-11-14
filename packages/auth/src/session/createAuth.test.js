import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuth } from './createAuth.js'
import { memoryAdapter } from './adapters/memory.js'
import { keyValueAdapter } from './adapters/keyValue.js'
import { sqlAdapter } from './adapters/sql.js'
import { modelAdapter } from './adapters/model.js'
import { createTokenSigner } from '../token/jwt.js'

const SECRET = 'test-secret-that-is-long-enough-0123456789'

// Builds a Web Request carrying the cookies a browser would send.
function browser() {
  const jar = new Map()
  return {
    jar,
    store(cookies) {
      for (const c of cookies) {
        const [pair, ...attrs] = c.split('; ')
        const eq = pair.indexOf('=')
        const name = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        const path = attrs.find((a) => a.startsWith('Path='))?.slice(5) ?? '/'
        const key = `${name}|${path}`
        if (attrs.some((a) => a === 'Max-Age=0')) jar.delete(key)
        else jar.set(key, { name, value, path })
      }
    },
    request(url, { method = 'GET', headers = {} } = {}) {
      const pathname = new URL(url, 'http://app.test').pathname
      const cookies = [...jar.values()]
        .filter((c) => pathname === c.path || pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/')
        .sort((a, b) => b.path.length - a.path.length)
        .map((c) => `${c.name}=${c.value}`)
        .join('; ')
      return new Request(new URL(url, 'http://app.test'), { method, headers: { ...(cookies ? { cookie: cookies } : {}), ...headers } })
    },
  }
}

function setup(options = {}) {
  const events = []
  const auth = createAuth({ secret: SECRET, adapter: memoryAdapter(), onEvent: (e) => events.push(e), ...options })
  return { auth, events, b: browser() }
}

test('sign in, read the session, refresh with rotation, sign out', async () => {
  const { auth, b } = setup()
  const login = await auth.signIn(b.request('/api/login', { method: 'POST' }), 42)
  b.store(login.cookies)
  assert.equal(login.session.userId, 42)
  assert.match(login.refreshToken, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/)

  const session = await auth.getSession(b.request('/dashboard'))
  assert.equal(session.userId, 42)
  assert.equal(session.sessionId, login.session.id)

  const refreshed = await auth.refresh(b.request('/api/auth/refresh', { method: 'POST' }))
  assert.equal(refreshed.ok, true)
  assert.notEqual(refreshed.refreshToken, login.refreshToken)
  b.store(refreshed.cookies)

  const out = await auth.signOut(b.request('/api/auth/logout', { method: 'POST' }))
  assert.equal(out.sessionId, login.session.id)
  // The old access token is refused at once: its session is gone.
  assert.equal(await auth.getSession(new Request('http://app.test/', { headers: { authorization: `Bearer ${refreshed.accessToken}` } })), null)
})

test('a replayed refresh token after the grace period revokes the whole session', async () => {
  const { auth, events } = setup({ rotationGrace: 1 })
  const login = await auth.signIn(null, 'u1')
  const cookie = (token) => new Request('http://app.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${token}` } })

  const first = await auth.refresh(cookie(login.refreshToken))
  assert.equal(first.ok, true)

  await new Promise((r) => setTimeout(r, 1100))
  const replay = await auth.refresh(cookie(login.refreshToken))
  assert.equal(replay.ok, false)
  assert.equal(replay.reason, 'reused')
  assert.ok(events.some((e) => e.type === 'session.reuse_detected'))

  // The thief's copy (the rotated token) is dead too.
  const after = await auth.refresh(cookie(first.refreshToken))
  assert.equal(after.ok, false)
})

test('parallel refreshes within the grace period both succeed without rotating twice', async () => {
  const { auth } = setup()
  const login = await auth.signIn(null, 'u1')
  const req = () => new Request('http://app.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${login.refreshToken}` } })
  const [a, b] = await Promise.all([auth.refresh(req()), auth.refresh(req())])
  assert.equal(a.ok && b.ok, true)
  assert.equal([a.refreshToken, b.refreshToken].filter(Boolean).length, 1, 'exactly one response rotates the cookie')
})

test('a forged secret for a known session id is refused without revoking the session', async () => {
  const { auth } = setup()
  const login = await auth.signIn(null, 'u1')
  const forged = `${login.session.id}.${'A'.repeat(43)}`
  const res = await auth.refresh(new Request('http://app.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${forged}` } }))
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'invalid')
  assert.ok(await auth.adapter.get(login.session.id), 'knowing a session id must not let anyone end it')
})

test('signing in ends the session the browser already had (no fixation)', async () => {
  const { auth, b } = setup()
  const planted = await auth.signIn(null, 'attacker')
  b.store(planted.cookies)
  const login = await auth.signIn(b.request('/api/auth/login', { method: 'POST' }), 'victim')
  assert.equal(await auth.adapter.get(planted.session.id), null)
  assert.ok(await auth.adapter.get(login.session.id))
})

test('idle and absolute expiry', async () => {
  const { auth } = setup({ idleTimeout: 1 })
  const login = await auth.signIn(null, 'u1')
  await new Promise((r) => setTimeout(r, 1100))
  const res = await auth.refresh(new Request('http://app.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${login.refreshToken}` } }))
  assert.equal(res.reason, 'expired')
  assert.equal(await auth.adapter.get(login.session.id), null)
})

test('cookie-authenticated cross-site writes are refused; bearer is not affected', async () => {
  const { auth, b } = setup()
  b.store((await auth.signIn(null, 'u1')).cookies)
  const evil = b.request('/api/transfer', { method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } })
  assert.equal(await auth.getSession(evil), null)
  const sibling = b.request('/api/transfer', { method: 'POST', headers: { origin: 'https://evil.app.test', 'sec-fetch-site': 'same-site' } })
  assert.equal(await auth.getSession(sibling), null, 'sibling subdomains are not trusted by default')
  const same = b.request('/api/transfer', { method: 'POST', headers: { origin: 'http://app.test', 'sec-fetch-site': 'same-origin' } })
  assert.equal((await auth.getSession(same)).userId, 'u1')
  const refresh = await auth.refresh(b.request('/api/auth/refresh', { method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } }))
  assert.equal(refresh.reason, 'cross-site')
})

test('secure requests use __Host-/__Secure- cookie prefixes', async () => {
  const { auth } = setup()
  const login = await auth.signIn(new Request('https://app.test/login', { method: 'POST' }), 'u1')
  assert.match(login.cookies[0], /^__Host-auth\.access=.*; Path=\/; HttpOnly; Secure; SameSite=Lax/)
  assert.match(login.cookies[1], /^__Secure-auth\.refresh=.*; Path=\/api\/auth; HttpOnly; Secure; SameSite=Lax/)
  const plain = await auth.signIn(new Request('http://localhost/login', { method: 'POST' }), 'u1')
  assert.match(plain.cookies[0], /^auth\.access=/)
  assert.doesNotMatch(plain.cookies[0], /Secure/)
})

test('non-persistent sessions use browser-session cookies', async () => {
  const { auth } = setup()
  const login = await auth.signIn(null, 'u1', { persistent: false })
  for (const c of login.cookies.slice(0, 2)) assert.doesNotMatch(c, /Max-Age/)
})

test('list and revoke sessions; revoke everywhere except current', async () => {
  const { auth } = setup()
  const a = await auth.signIn(null, 'u1')
  const b = await auth.signIn(null, 'u1')
  await auth.signIn(null, 'u2')
  const list = await auth.listSessions('u1', { currentSessionId: a.session.id })
  assert.equal(list.length, 2)
  assert.equal(list.find((s) => s.id === a.session.id).current, true)
  assert.equal('tokenHash' in list[0], false, 'hashes never leave the engine')
  assert.equal(await auth.revokeAllSessions('u1', { exceptSessionId: a.session.id }), 1)
  assert.equal(await auth.adapter.get(b.session.id), null)
  assert.ok(await auth.adapter.get(a.session.id))
})

test('validateSession can end a session at refresh (banned user)', async () => {
  const { auth } = setup({ validateSession: (s) => s.userId !== 'banned' })
  const login = await auth.signIn(null, 'banned')
  const res = await auth.refresh(new Request('http://app.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${login.refreshToken}` } }))
  assert.equal(res.reason, 'rejected')
})

test('extra claims end up in the access token', async () => {
  const { auth } = setup({ claims: (s) => ({ userId: s.userId, role: 'admin' }) })
  const login = await auth.signIn(null, 7)
  const claims = await auth.verifyAccessToken(login.accessToken)
  assert.equal(claims.userId, 7)
  assert.equal(claims.role, 'admin')
  assert.equal(claims.sub, '7')
})

test('secret rotation keeps existing sessions and tokens working', async () => {
  const adapter = memoryAdapter()
  const OLD = 'old-secret-old-secret-old-secret-0000'
  const NEW = 'new-secret-new-secret-new-secret-1111'
  const before = createAuth({ secret: OLD, adapter })
  const login = await before.signIn(null, 'u1')
  const after = createAuth({ secret: [NEW, OLD], adapter })
  assert.equal((await after.verifyAccessToken(login.accessToken)).uid, 'u1')
  const res = await after.refresh(new Request('http://x.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${login.refreshToken}` } }))
  assert.equal(res.ok, true)
  // Dropping the old secret invalidates what it signed.
  const dropped = createAuth({ secret: NEW, adapter })
  assert.equal(await dropped.verifyAccessToken(login.accessToken), null)
})

test('an access token is not accepted as another token type and vice versa', async () => {
  const { auth } = setup()
  const verifyLink = await auth.tokens.sign({ sid: 'x', uid: 1 }, { type: 'email-verify', expiresIn: '1d' })
  assert.equal(await auth.verifyAccessToken(verifyLink), null)
  const login = await auth.signIn(null, 1)
  assert.equal((await auth.tokens.verify(login.accessToken, { type: 'email-verify' })).valid, false)
})

test('a session id in the token must belong to the same user', async () => {
  const { auth } = setup()
  const victim = await auth.signIn(null, 'victim')
  const signer = createTokenSigner({ secret: SECRET })
  // Even a correctly signed token naming someone else's session fails
  // the revocation check (defence in depth against claim mix-ups).
  const forged = await signer.sign({ sid: victim.session.id, uid: 'attacker' }, { type: 'access', expiresIn: 60 })
  assert.equal(await auth.getSession(new Request('http://x.test/', { headers: { authorization: `Bearer ${forged}` } })), null)
})

// --- adapters --------------------------------------------------------------

async function adapterContract(name, makeAdapter) {
  test(`${name}: full lifecycle`, async () => {
    const auth = createAuth({ secret: SECRET, adapter: await makeAdapter() })
    const login = await auth.signIn(new Request('http://x.test/login', { method: 'POST', headers: { 'user-agent': 'UA/1' } }), 5, { data: { mfa: true } })
    const req = (t) => new Request('http://x.test/api/auth/refresh', { method: 'POST', headers: { cookie: `auth.refresh=${t}` } })
    const r1 = await auth.refresh(req(login.refreshToken))
    assert.equal(r1.ok, true)
    const sessions = await auth.listSessions(5)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].userAgent, 'UA/1')
    assert.deepEqual(sessions[0].data, { mfa: true })
    const s = await auth.getSession(new Request('http://x.test/', { headers: { authorization: `Bearer ${r1.accessToken}` } }))
    assert.equal(String(s.userId), '5')
    assert.equal(await auth.revokeAllSessions(5), 1)
    assert.equal((await auth.refresh(req(r1.refreshToken))).ok, false)
  })
}

adapterContract('memoryAdapter', () => memoryAdapter())

adapterContract('keyValueAdapter', () => {
  const map = new Map()
  return keyValueAdapter({
    async get(k) {
      return map.get(k) ?? null
    },
    async set(k, v) {
      map.set(k, v)
    },
    async delete(k) {
      map.delete(k)
    },
  })
})

adapterContract('sqlAdapter (sqlite)', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { createTableSql } = await import('./adapters/sql.js')
  const db = new DatabaseSync(':memory:')
  for (const sql of createTableSql({ dialect: 'sqlite' })) db.exec(sql)
  return sqlAdapter({
    dialect: 'sqlite',
    query: async (sql, params) => {
      const stmt = db.prepare(sql)
      return /^\s*select/i.test(sql) ? stmt.all(...params) : stmt.run(...params).changes
    },
  })
})

adapterContract('modelAdapter (Tylix ORM shape)', () => {
  const rows = []
  let nextId = 1
  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v)
  class FakeModel {
    static async create(data) {
      const row = { id: nextId++, ...data, created_at: new Date().toISOString() }
      rows.push(row)
      return row
    }
    static query() {
      const where = {}
      const q = {
        where(k, v) {
          where[k] = v
          return q
        },
        async first() {
          return rows.find((r) => matches(r, where)) ?? null
        },
        async get() {
          return rows.filter((r) => matches(r, where))
        },
      }
      return q
    }
    static async updateWhere(where, values) {
      const hit = rows.filter((r) => matches(r, where))
      for (const r of hit) Object.assign(r, values)
      return hit.length
    }
    static async delete(id) {
      rows.splice(rows.findIndex((r) => r.id === id), 1)
    }
  }
  return modelAdapter(FakeModel)
})
