import { base64urlEncode, hmacSign, randomToken, timingSafeEqual } from '../core/crypto.js'
import { createKeyring, isProduction, toSeconds } from '../core/keys.js'
import { createSealer } from '../core/seal.js'
import { createTokenSigner } from '../token/jwt.js'
import { expireCookie, serializeCookie } from '../http/cookies.js'
import { getClientIp, getCookiesAll, getHeader, isSecureRequest } from '../http/request.js'
import { isCrossSiteRequest } from '../http/origin.js'
import { memoryAdapter } from './adapters/memory.js'

// Sessions for any framework.
//
// A login creates a server-side session and two cookies:
//   access   a short-lived signed JWT (default 15 min). Verifying it needs
//            no database, so it works in edge middleware.
//   refresh  "<sessionId>.<secret>", httpOnly, path-scoped. Only an HMAC
//            of it is stored. Every refresh ROTATES it; presenting an old
//            one again (outside a short grace period for parallel tabs)
//            means it was copied, and the whole session is revoked.
//
// Sessions have an absolute lifetime and an idle timeout, can be listed
// ("your devices") and revoked one by one or all at once, and a login
// always replaces whatever session the browser had (no fixation).

const SESSION_ID = /^[A-Za-z0-9_-]{22}$/
const SECRET = /^[A-Za-z0-9_-]{43}$/

function publicSession(record, currentId) {
  if (!record) return null
  const { tokenHash, prevTokenHash, rotatedAt, ...rest } = record
  return currentId === undefined ? rest : { ...rest, current: record.id === currentId }
}

function parseRefreshToken(value) {
  if (typeof value !== 'string') return null
  const dot = value.indexOf('.')
  if (dot === -1) return null
  const id = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  if (!SESSION_ID.test(id) || !SECRET.test(secret)) return null
  return { id, secret }
}

export function createAuth(options = {}) {
  const {
    secret,
    adapter = memoryAdapter(),
    issuer,
    audience,
    accessTokenTtl = '15m',
    sessionTtl = '30d',
    shortSessionTtl = '1d',
    idleTimeout = '14d',
    rotationGrace = '30s',
    trustProxy = false,
    trustedOrigins = [],
    checkRevocation = true,
    allowBearer = true,
    csrf = true,
    storeIp = true,
    storeUserAgent = true,
    claims: extraClaims,
    validateSession,
    onEvent,
  } = options

  const cookieOptions = {
    accessName: 'auth.access',
    refreshName: 'auth.refresh',
    prefix: true,
    refreshPath: '/api/auth',
    sameSite: 'lax',
    domain: undefined,
    secure: 'auto',
    legacyRefreshPaths: [],
    ...options.cookies,
  }

  if (adapter.ephemeral && isProduction()) {
    console.warn('[@tylix/auth] Sessions are kept in memory: they vanish on restart and are not shared between servers. Pass an `adapter`.')
  }

  const keyring = createKeyring(secret)
  const tokens = createTokenSigner({ keyring, issuer, audience })
  const sealer = createSealer({ keyring })

  const accessTtl = toSeconds(accessTokenTtl, 'accessTokenTtl')
  const longTtlMs = toSeconds(sessionTtl, 'sessionTtl') * 1000
  const shortTtlMs = toSeconds(shortSessionTtl, 'shortSessionTtl') * 1000
  const idleMs = toSeconds(idleTimeout, 'idleTimeout') * 1000
  const graceMs = toSeconds(rotationGrace, 'rotationGrace') * 1000

  const emit = (type, details) => {
    if (typeof onEvent !== 'function') return
    try {
      Promise.resolve(onEvent({ type, at: new Date().toISOString(), ...details })).catch(() => {})
    } catch {}
  }

  // --- cookies ---------------------------------------------------------

  function secureFor(request) {
    if (cookieOptions.secure === true || cookieOptions.secure === false) return cookieOptions.secure
    return isProduction() || (request ? isSecureRequest(request, { trustProxy }) : false)
  }

  // __Host- (access, Path=/) and __Secure- (refresh) prefixes stop a
  // sibling subdomain or an http:// page from planting or overwriting the
  // cookies. They need HTTPS, so plain-http dev uses the bare names.
  function cookieNames(request) {
    const secure = secureFor(request)
    if (!cookieOptions.prefix || !secure) {
      return { access: cookieOptions.accessName, refresh: cookieOptions.refreshName, secure }
    }
    return {
      access: `${cookieOptions.domain ? '__Secure-' : '__Host-'}${cookieOptions.accessName}`,
      refresh: `__Secure-${cookieOptions.refreshName}`,
      secure,
    }
  }

  function base(secure) {
    return { secure, httpOnly: true, sameSite: cookieOptions.sameSite, domain: cookieOptions.domain }
  }

  function sessionCookies(request, { accessToken, refreshToken, session }) {
    const names = cookieNames(request)
    const opts = base(names.secure)
    const out = []
    if (accessToken) {
      out.push(serializeCookie(names.access, accessToken, { ...opts, path: '/', maxAge: session?.persistent === false ? undefined : accessTtl }))
    }
    if (refreshToken) {
      const maxAge = session?.persistent === false ? undefined : Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))
      out.push(serializeCookie(names.refresh, refreshToken, { ...opts, path: cookieOptions.refreshPath, priority: 'High', maxAge }))
      for (const path of cookieOptions.legacyRefreshPaths) out.push(expireCookie(names.refresh, { ...opts, path }))
    }
    return out
  }

  function clearCookies(request) {
    const names = cookieNames(request)
    const opts = base(names.secure)
    return [
      expireCookie(names.access, { ...opts, path: '/' }),
      expireCookie(names.refresh, { ...opts, path: cookieOptions.refreshPath }),
      ...cookieOptions.legacyRefreshPaths.map((path) => expireCookie(names.refresh, { ...opts, path })),
    ]
  }

  // --- refresh tokens ---------------------------------------------------

  async function hashSecret(id, value, index = 0) {
    return base64urlEncode(await hmacSign(await keyring.hmac('refresh', index), `${id}.${value}`))
  }

  // Which stored hash (current/previous) the presented secret matches,
  // trying every configured key so rotation of AUTH_SECRET keeps sessions.
  async function matchSecret(record, value) {
    for (let i = 0; i < keyring.size; i++) {
      const hash = await hashSecret(record.id, value, i)
      if (record.tokenHash && timingSafeEqual(hash, record.tokenHash)) return 'current'
      if (record.prevTokenHash && timingSafeEqual(hash, record.prevTokenHash)) return 'previous'
    }
    return null
  }

  function readRefreshCandidates(request) {
    const all = getCookiesAll(request)[cookieNames(request).refresh] ?? []
    return all.map(parseRefreshToken).filter(Boolean)
  }

  function isExpired(record, now = Date.now()) {
    return record.expiresAt <= now || (record.idleExpiresAt != null && record.idleExpiresAt <= now)
  }

  async function issueAccessToken(record) {
    const extra = typeof extraClaims === 'function' ? await extraClaims(publicSession(record)) : {}
    return tokens.sign({ ...extra, sid: record.id, uid: record.userId }, { type: 'access', expiresIn: accessTtl, subject: record.userId })
  }

  function requestMeta(request) {
    if (!request) return {}
    return {
      ip: storeIp ? getClientIp(request, { trustProxy }) : null,
      userAgent: storeUserAgent ? (getHeader(request, 'user-agent') ?? '').slice(0, 512) || null : null,
    }
  }

  // --- public API ---------------------------------------------------------

  async function signIn(request, userId, { persistent = true, data = null } = {}) {
    if (userId == null || userId === '') throw new TypeError('signIn needs a user id')

    // Whatever session this browser had is ended first: a login must
    // never continue a session someone else may have planted.
    if (request) {
      for (const candidate of readRefreshCandidates(request)) {
        const existing = await adapter.get(candidate.id)
        if (existing && (await matchSecret(existing, candidate.secret))) await adapter.delete(existing.id)
      }
    }

    const now = Date.now()
    const id = randomToken(16)
    const value = randomToken(32)
    const expiresAt = now + (persistent ? longTtlMs : shortTtlMs)
    const meta = requestMeta(request)
    const record = {
      id,
      userId,
      tokenHash: await hashSecret(id, value),
      prevTokenHash: null,
      rotatedAt: null,
      createdAt: now,
      lastUsedAt: now,
      expiresAt,
      idleExpiresAt: Math.min(now + idleMs, expiresAt),
      persistent,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      data,
    }
    await adapter.create(record)

    const accessToken = await issueAccessToken(record)
    const refreshToken = `${id}.${value}`
    const cookies = sessionCookies(request, { accessToken, refreshToken, session: record })
    emit('session.created', { sessionId: id, userId, ip: record.ip, userAgent: record.userAgent })
    return { session: publicSession(record), accessToken, refreshToken, cookies }
  }

  /** Stateless check of an access token: signature, type and expiry only. */
  async function verifyAccessToken(token) {
    const result = await tokens.verify(token, { type: 'access' })
    return result.valid ? result.payload : null
  }

  function readAccessToken(request) {
    if (allowBearer) {
      const header = getHeader(request, 'authorization')
      const match = header && /^Bearer\s+([A-Za-z0-9._~+/-]+=*)\s*$/i.exec(header)
      if (match) return { token: match[1], via: 'bearer' }
    }
    const cookie = getCookiesAll(request)[cookieNames(request).access]?.[0]
    return cookie ? { token: cookie, via: 'cookie' } : null
  }

  /**
   * The signed-in user for this request, or null. With checkRevocation
   * (the default) the session is looked up too, so logout, "sign out
   * everywhere" and password resets take effect immediately rather than
   * when the access token expires. Pass { checkRevocation: false } in
   * edge middleware that can't reach the session store.
   */
  async function getSession(request, { checkRevocation: check = checkRevocation } = {}) {
    const found = readAccessToken(request)
    if (!found) return null
    // Cookies ride along on cross-site requests; bearer tokens don't.
    if (found.via === 'cookie' && csrf && isCrossSiteRequest(request, { trustedOrigins, trustProxy })) return null

    const claims = await verifyAccessToken(found.token)
    if (!claims || typeof claims.sid !== 'string') return null

    if (!check) return { userId: claims.uid ?? claims.sub, sessionId: claims.sid, claims, session: null, via: found.via }

    const record = await adapter.get(claims.sid)
    if (!record || isExpired(record) || String(record.userId) !== String(claims.uid ?? claims.sub)) return null
    return { userId: record.userId, sessionId: record.id, claims, session: publicSession(record), via: found.via }
  }

  /** Rotates the refresh token and issues a new access token. */
  async function refresh(request) {
    const denied = (reason, extra = {}) => ({ ok: false, reason, cookies: clearCookies(request), ...extra })
    if (csrf && isCrossSiteRequest(request, { trustedOrigins, trustProxy })) {
      return { ok: false, reason: 'cross-site', cookies: [] }
    }

    const candidates = readRefreshCandidates(request)
    if (candidates.length === 0) return denied('missing')

    for (const candidate of candidates) {
      let record = await adapter.get(candidate.id)
      if (!record) continue
      const now = Date.now()
      if (isExpired(record, now)) {
        await adapter.delete(record.id)
        emit('session.expired', { sessionId: record.id, userId: record.userId })
        return denied('expired')
      }

      let match = await matchSecret(record, candidate.secret)
      if (match === null) continue

      if (match === 'current') {
        const value = randomToken(32)
        const tokenHash = await hashSecret(record.id, value)
        const patch = {
          tokenHash,
          prevTokenHash: record.tokenHash,
          rotatedAt: now,
          lastUsedAt: now,
          idleExpiresAt: Math.min(now + idleMs, record.expiresAt),
        }
        const swapped = await adapter.update(record.id, patch, { expectTokenHash: record.tokenHash })
        if (swapped) {
          record = { ...record, ...patch }
          if (typeof validateSession === 'function' && !(await validateSession(publicSession(record)))) {
            await adapter.delete(record.id)
            emit('session.rejected', { sessionId: record.id, userId: record.userId })
            return denied('rejected')
          }
          const accessToken = await issueAccessToken(record)
          const refreshToken = `${record.id}.${value}`
          emit('session.refreshed', { sessionId: record.id, userId: record.userId })
          return { ok: true, session: publicSession(record), accessToken, refreshToken, cookies: sessionCookies(request, { accessToken, refreshToken, session: record }) }
        }
        // Another request (a second tab) rotated it first: re-read and
        // handle this one as a token that was just superseded.
        record = await adapter.get(candidate.id)
        if (!record) return denied('revoked')
        match = await matchSecret(record, candidate.secret)
      }

      if (match === 'previous' && record.rotatedAt != null && now - record.rotatedAt <= graceMs) {
        // A parallel refresh: give this request an access token but leave
        // the refresh cookie to the response that rotated it.
        const accessToken = await issueAccessToken(record)
        return { ok: true, session: publicSession(record), accessToken, refreshToken: null, cookies: sessionCookies(request, { accessToken, session: record }) }
      }

      // An already-rotated token, replayed after the grace period: someone
      // holds a copy. End the session for both of them.
      await adapter.delete(record.id)
      emit('session.reuse_detected', { sessionId: record.id, userId: record.userId, ...requestMeta(request) })
      return denied('reused')
    }
    return denied('invalid')
  }

  /** Ends this browser's session and clears its cookies. */
  async function signOut(request) {
    let ended = null
    for (const candidate of readRefreshCandidates(request)) {
      const record = await adapter.get(candidate.id)
      if (record && (await matchSecret(record, candidate.secret))) {
        await adapter.delete(record.id)
        ended = record
      }
    }
    if (!ended) {
      // No refresh cookie reached us (another path, or a bearer client):
      // a valid access token identifies the session just as well.
      const found = readAccessToken(request)
      const claims = found && (found.via === 'bearer' || !isCrossSiteRequest(request, { trustedOrigins, trustProxy })) ? await verifyAccessToken(found.token) : null
      if (claims?.sid) {
        const record = await adapter.get(claims.sid)
        if (record && String(record.userId) === String(claims.uid ?? claims.sub)) {
          await adapter.delete(record.id)
          ended = record
        }
      }
    }
    if (ended) emit('session.revoked', { sessionId: ended.id, userId: ended.userId, reason: 'sign-out' })
    return { ok: true, sessionId: ended?.id ?? null, cookies: clearCookies(request) }
  }

  async function revokeSession(sessionId) {
    const record = await adapter.get(sessionId)
    if (!record) return false
    await adapter.delete(sessionId)
    emit('session.revoked', { sessionId, userId: record.userId, reason: 'revoked' })
    return true
  }

  /** "Sign out everywhere" (optionally keeping one session). Use after password changes. */
  async function revokeAllSessions(userId, { exceptSessionId } = {}) {
    const count = await adapter.deleteByUser(userId, { exceptId: exceptSessionId })
    emit('session.revoked_all', { userId, count, exceptSessionId: exceptSessionId ?? null })
    return count
  }

  async function listSessions(userId, { currentSessionId } = {}) {
    const now = Date.now()
    const records = await adapter.listByUser(userId)
    return records.filter((r) => !isExpired(r, now)).sort((a, b) => b.lastUsedAt - a.lastUsedAt).map((r) => publicSession(r, currentSessionId))
  }

  /** True while the session exists, belongs to userId (when given) and hasn't expired. */
  async function isSessionActive(sessionId, userId) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return false
    const record = await adapter.get(sessionId)
    if (!record || isExpired(record)) return false
    return userId === undefined || String(record.userId) === String(userId)
  }

  /** Stores extra data on a session (for example { mfa: true } after a second factor). */
  async function updateSessionData(sessionId, data) {
    return adapter.update(sessionId, { data })
  }

  return {
    signIn,
    signOut,
    refresh,
    getSession,
    verifyAccessToken,
    revokeSession,
    revokeAllSessions,
    listSessions,
    updateSessionData,
    isSessionActive,
    clearCookies,
    cookieNames,
    isCrossSite: (request) => isCrossSiteRequest(request, { trustedOrigins, trustProxy }),
    tokens,
    sealer,
    adapter,
    options: { accessTokenTtl: accessTtl, refreshPath: cookieOptions.refreshPath, trustProxy, trustedOrigins },
  }
}
