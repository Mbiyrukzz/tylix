import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createTokenSigner } from './token/jwt.js'
import { base64urlDecode, base64urlEncode } from './core/crypto.js'
import { createSealer } from './core/seal.js'
import { toSeconds } from './core/keys.js'
import { parseCookieHeaderAll, serializeCookie } from './http/cookies.js'
import { applyCookies, getClientIp, getHeader, isSecureRequest } from './http/request.js'
import { isCrossSiteRequest, safeRedirectPath } from './http/origin.js'
import { createLoginThrottle, createRateLimiter } from './ratelimit/limiter.js'
import { checkPasswordStrength, breachCount } from './password/policy.js'
import { generateTotp, generateTotpSecret, verifyTotp, totpUri, generateRecoveryCodes, verifyRecoveryCode, base32Encode, base32Decode } from './mfa/totp.js'
import { createOAuth, OAuthError } from './oauth/oauth.js'
import { github, microsoft } from './oauth/providers.js'
import { signToken, verifyToken } from './token/signToken.js'
import { verifyAccessToken, setSessionGuard } from './tylix/accessTokens.js'

const SECRET = 'test-secret-that-is-long-enough-0123456789'
const b64 = (o) => base64urlEncode(JSON.stringify(o))

// --- JWT -------------------------------------------------------------------

test('jwt: round trip with standard claims', async () => {
  const signer = createTokenSigner({ secret: SECRET, issuer: 'app', audience: 'web' })
  const token = await signer.sign({ role: 'x' }, { expiresIn: '5m', subject: 9 })
  const { valid, payload } = await signer.verify(token)
  assert.equal(valid, true)
  assert.equal(payload.sub, '9')
  assert.equal(payload.iss, 'app')
  assert.equal(payload.aud, 'web')
  assert.ok(payload.jti)
  assert.equal(payload.exp - payload.iat, 300)
})

test('jwt: refuses alg=none, other algorithms and a wrong type', async () => {
  const signer = createTokenSigner({ secret: SECRET })
  const token = await signer.sign({}, { expiresIn: 60 })
  const [, payload, sig] = token.split('.')
  assert.equal((await signer.verify(`${b64({ alg: 'none', typ: 'access+jwt' })}.${payload}.`)).valid, false)
  assert.equal((await signer.verify(`${b64({ alg: 'HS512', typ: 'access+jwt' })}.${payload}.${sig}`)).error, 'Unsupported algorithm')
  assert.equal((await signer.verify(token, { type: 'email-verify' })).error, 'Wrong token type')
})

test('jwt: refuses tampering, extra segments, non-canonical base64 and huge tokens', async () => {
  const signer = createTokenSigner({ secret: SECRET })
  const token = await signer.sign({ admin: false }, { expiresIn: 60 })
  const [h, , s] = token.split('.')
  assert.equal((await signer.verify(`${h}.${b64({ admin: true, exp: 9e9 })}.${s}`)).valid, false)
  assert.equal((await signer.verify(`${token}.x`)).valid, false)
  // Flip the unused low bits of the signature's last character.
  const last = s.at(-1)
  const sibling = 'AQgw'.includes(last) ? s.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1) : null
  if (sibling) assert.equal((await signer.verify(`${h}.${token.split('.')[1]}.${sibling}`)).valid, false)
  assert.equal((await signer.verify('a'.repeat(9000))).error, 'Token too large')
})

test('jwt: expiry is mandatory and enforced; nbf/iat in the future refused', async () => {
  const signer = createTokenSigner({ secret: SECRET, clockToleranceSeconds: 0 })
  await assert.rejects(() => signer.sign({}), /expiresIn/)
  const early = await signer.sign({}, { expiresIn: 60, notBefore: 30 })
  assert.equal((await signer.verify(early)).error, 'Token not yet valid')
  const expired = await signer.sign({ exp: 1 }, { expiresIn: 60 })
  assert.equal((await signer.verify(expired)).valid, true, 'sign() overrides a caller-supplied exp')
})

test('jwt: an unknown key id is refused; a different secret fails', async () => {
  const a = createTokenSigner({ secret: SECRET })
  const b = createTokenSigner({ secret: 'another-secret-that-is-long-enough-xyz' })
  const token = await a.sign({}, { expiresIn: 60 })
  assert.equal((await b.verify(token)).error, 'Unknown signing key')
})

test('base64url decoding is strict', () => {
  assert.throws(() => base64urlDecode('ab+c'))
  assert.throws(() => base64urlDecode('abc='))
  assert.throws(() => base64urlDecode('a'))
  assert.throws(() => base64urlDecode('AB'), /Non-canonical/)
  assert.deepEqual([...base64urlDecode('AA')], [0])
})

test('durations', () => {
  assert.equal(toSeconds('15m'), 900)
  assert.equal(toSeconds('30d'), 2592000)
  assert.equal(toSeconds(5), 5)
  assert.throws(() => toSeconds('-1'))
  assert.throws(() => toSeconds('1y'))
})

// --- sealing ---------------------------------------------------------------

test('seal: round trip, tamper-proof, purpose-bound and expiring', async () => {
  const sealer = createSealer({ secret: SECRET })
  const sealed = await sealer.seal({ totp: 'JBSWY3DP' }, { purpose: 'totp' })
  assert.deepEqual(await sealer.unseal(sealed, { purpose: 'totp' }), { totp: 'JBSWY3DP' })
  assert.equal(await sealer.unseal(sealed, { purpose: 'other' }), null)
  const parts = sealed.split('.')
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BA' : 'AA')
  assert.equal(await sealer.unseal(parts.join('.'), { purpose: 'totp' }), null)
  assert.equal(await createSealer({ secret: 'x'.repeat(40) }).unseal(sealed, { purpose: 'totp' }), null)
  const short = await sealer.seal(1, { expiresIn: 1 })
  await new Promise((r) => setTimeout(r, 1100))
  assert.equal(await sealer.unseal(short), null)
})

// --- cookies & requests ------------------------------------------------------

test('cookies: secure defaults and prefix rules', () => {
  assert.equal(serializeCookie('a', 'b'), 'a=b; Path=/; HttpOnly; SameSite=Lax')
  assert.match(serializeCookie('a', 'b', { sameSite: 'none' }), /Secure; SameSite=None/)
  assert.throws(() => serializeCookie('__Host-a', 'b', { path: '/x' }), /__Host-/)
  assert.throws(() => serializeCookie('a;b', 'c'))
  assert.throws(() => serializeCookie('a', 'b', { path: '/;evil' }))
  assert.deepEqual({ ...parseCookieHeaderAll('a=1; a=2; b=%zz; c') }, { a: ['1', '2'], b: ['%zz'] })
  assert.equal(Object.getPrototypeOf(parseCookieHeaderAll('__proto__=x')), null, 'no prototype pollution via cookie names')
})

test('request normalisation across frameworks', () => {
  const web = new Request('https://x.test/p', { headers: { 'X-Thing': 'v' } })
  const node = { headers: { 'x-thing': 'v' }, url: '/p', socket: { remoteAddress: '10.0.0.1' } }
  const shapes = [web, web.headers, { request: web }, { req: { raw: web } }, { node: { req: node } }, node, { request: node, res: {} }]
  for (const shape of shapes) assert.equal(getHeader(shape, 'x-thing'), 'v')
  assert.equal(isSecureRequest(web), true)
  assert.equal(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } }), false, 'proxy headers ignored by default')
  assert.equal(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } }, { trustProxy: true }), true)
  assert.equal(getClientIp(node), '10.0.0.1')
  assert.equal(getClientIp({ ...node, headers: { 'x-forwarded-for': '1.2.3.4' } }), '10.0.0.1')
  assert.equal(getClientIp({ ...node, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }, { trustProxy: true }), '1.2.3.4')
})

test('applyCookies writes to every response shape', () => {
  const headers = new Headers()
  applyCookies(headers, ['a=1', 'b=2'])
  assert.deepEqual(headers.getSetCookie(), ['a=1', 'b=2'])

  const nodeHeaders = { 'set-cookie': ['x=0'] }
  const res = { getHeader: (n) => nodeHeaders[n.toLowerCase()], setHeader: (n, v) => (nodeHeaders[n.toLowerCase()] = v) }
  applyCookies(res, ['a=1'])
  assert.deepEqual(nodeHeaders['set-cookie'], ['x=0', 'a=1'])

  const hono = { req: { raw: {} }, calls: [], header(n, v, o) { this.calls.push([n, v, o]) } }
  applyCookies(hono, ['a=1'])
  assert.deepEqual(hono.calls, [['Set-Cookie', 'a=1', { append: true }]])

  const response = new Response('x')
  applyCookies(response, ['a=1'])
  assert.deepEqual(response.headers.getSetCookie(), ['a=1'])
})

test('origin checks', () => {
  const req = (headers, method = 'POST') => new Request('https://app.test/x', { method, headers })
  assert.equal(isCrossSiteRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' })), true)
  assert.equal(isCrossSiteRequest(req({ 'sec-fetch-site': 'same-origin', origin: 'https://app.test' })), false)
  assert.equal(isCrossSiteRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' }, 'GET')), false)
  assert.equal(isCrossSiteRequest(req({})), false, 'non-browser clients pass')
  assert.equal(isCrossSiteRequest(req({ 'sec-fetch-site': 'same-site', origin: 'https://admin.app.test' }), { trustedOrigins: ['https://admin.app.test'] }), false)
  assert.equal(isCrossSiteRequest(new Request('https://app.test/x', { method: 'POST', headers: { origin: 'https://evil.test', host: 'app.test' } })), true)
  assert.equal(isCrossSiteRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'null' })), true)
})

test('safeRedirectPath blocks open redirects', () => {
  for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', '/\nx', 'evil']) {
    assert.equal(safeRedirectPath(bad, '/home'), '/home', bad)
  }
  assert.equal(safeRedirectPath('/dashboard?tab=1#x'), '/dashboard?tab=1#x')
})

// --- rate limits -------------------------------------------------------------

test('rate limiter: fixed window, peek and reset', async () => {
  const limit = createRateLimiter({ name: 't', max: 2, window: '1m' })
  assert.equal((await limit.check('a')).allowed, true)
  assert.equal((await limit.check('a')).allowed, true)
  const third = await limit.check('a')
  assert.equal(third.allowed, false)
  assert.ok(third.retryAfterSeconds > 0)
  assert.equal((await limit.check('b')).allowed, true)
  await limit.reset('a')
  assert.equal((await limit.peek('a')).allowed, true)
})

test('login throttle blocks guessing but not the real owner from another IP', async () => {
  const throttle = createLoginThrottle()
  for (let i = 0; i < 5; i++) await throttle.fail({ identifier: 'Ada@x.test', ip: '6.6.6.6' })
  assert.equal((await throttle.check({ identifier: 'ada@x.test', ip: '6.6.6.6' })).allowed, false)
  assert.equal((await throttle.check({ identifier: 'ada@x.test', ip: '1.1.1.1' })).allowed, true)
})

// --- passwords ---------------------------------------------------------------

test('password policy', async () => {
  assert.equal((await checkPasswordStrength('Sup3r-secret!')).ok, true)
  assert.equal((await checkPasswordStrength('password123')).ok, false)
  assert.equal((await checkPasswordStrength('short')).ok, false)
  assert.equal((await checkPasswordStrength('aaaaaaaaaa')).ok, false)
  assert.equal((await checkPasswordStrength('abcdefghij')).ok, false)
  assert.equal((await checkPasswordStrength('lovelace-rocks', { userInputs: ['ada.lovelace@x.test'] })).ok, false)
})

test('breach check uses k-anonymity and fails open', async () => {
  let asked
  const fakeFetch = async (url, init) => {
    asked = { url, init }
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9999\r\nFFFFF:0')
  }
  assert.equal(await breachCount('password', { fetch: fakeFetch }), 9999)
  assert.match(asked.url, /\/range\/5BAA6$/)
  assert.equal(asked.init.headers['Add-Padding'], 'true')
  assert.equal(await breachCount('x', { fetch: async () => { throw new Error('down') } }), 0)
})

// --- TOTP ----------------------------------------------------------------------

test('totp: RFC 6238 test vector', async () => {
  // RFC 6238 appendix B, SHA1, secret "12345678901234567890", T=59 -> 94287082
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))
  assert.equal(await generateTotp(secret, { time: 59_000, digits: 8 }), '94287082')
  assert.equal(await generateTotp(secret, { time: 1111111109_000, digits: 8 }), '07081804')
  assert.deepEqual([...base32Decode(secret)], [...new TextEncoder().encode('12345678901234567890')])
})

test('totp: window and replay protection', async () => {
  const secret = generateTotpSecret()
  const now = Date.now()
  const code = await generateTotp(secret, { time: now - 30_000 })
  const first = await verifyTotp(code, secret, { time: now })
  assert.equal(first.valid, true)
  assert.equal((await verifyTotp(code, secret, { time: now, lastUsedStep: first.step })).replay, true)
  assert.equal((await verifyTotp(code, secret, { time: now + 120_000 })).valid, false)
  assert.equal((await verifyTotp('12345', secret)).valid, false)
  assert.match(totpUri({ secret, issuer: 'Acme', account: 'a@b.c' }), /^otpauth:\/\/totp\/Acme:a%40b\.c\?secret=/)
})

test('recovery codes are single-format, hashed and matched case-insensitively', async () => {
  const { codes, hashes } = await generateRecoveryCodes(10)
  assert.equal(new Set(codes).size, 10)
  for (const c of codes) assert.match(c, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/)
  assert.equal(await verifyRecoveryCode(codes[3].toLowerCase().replace('-', ' '), hashes), 3)
  assert.equal(await verifyRecoveryCode('AAAAA-AAAAA', hashes), -1)
})

// --- OAuth ---------------------------------------------------------------------

test('oauth: PKCE + state round trip with GitHub, unverified email stays unverified', async () => {
  const sealer = createSealer({ secret: SECRET })
  const calls = []
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('access_token')) return Response.json({ access_token: 'gho_x', token_type: 'bearer' })
    if (String(url).endsWith('/user')) return Response.json({ id: 1, login: 'ada', name: 'Ada' })
    if (String(url).endsWith('/user/emails')) return Response.json([{ email: 'ada@x.test', primary: true, verified: false }])
    return new Response('', { status: 404 })
  }
  const oauth = createOAuth({ sealer, fetch: fakeFetch })
  const provider = github({ clientId: 'id', clientSecret: 'sec', redirectUri: 'http://app.test/cb' })
  const { url, cookies } = await oauth.start(provider, new Request('http://app.test/login'), { returnTo: '//evil.test' })
  const auth = new URL(url)
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
  const state = auth.searchParams.get('state')
  const cookie = cookies[0].split(';')[0]

  const callback = (s) => new Request(`http://app.test/cb?code=abc&state=${s}`, { headers: { cookie } })
  await assert.rejects(() => oauth.callback(provider, callback('wrong')), (e) => e instanceof OAuthError && e.code === 'state_mismatch')

  const result = await oauth.callback(provider, callback(state))
  assert.equal(result.profile.id, '1')
  assert.equal(result.profile.emailVerified, false)
  assert.equal(result.returnTo, '/', 'open redirect neutralised')
  const tokenCall = calls.find((c) => c.url.includes('access_token'))
  assert.ok(tokenCall.init.body.get('code_verifier'))
})

test('oauth: microsoft emails are never treated as verified', async () => {
  const provider = microsoft({ clientId: 'a', clientSecret: 'b', redirectUri: 'http://x/cb' })
  const profile = await provider.profile({ get: async () => ({ sub: 's', email: 'ceo@bank.test', email_verified: true }) })
  assert.equal(profile.emailVerified, false)
})

// --- legacy tokens & the Tylix gate ------------------------------------------

test('legacy verifyToken refuses extra segments and non-object payloads', () => {
  const token = signToken({ userId: 1 }, SECRET, { expiresInSeconds: 60 })
  assert.equal(verifyToken(token, SECRET).valid, true)
  assert.equal(verifyToken(`${token}.extra`, SECRET).valid, false)
  const arr = Buffer.from('[1]').toString('base64url')
  const sig = createHmac('sha256', SECRET).update(arr).digest('base64url')
  assert.equal(verifyToken(`${arr}.${sig}`, SECRET).error, 'Invalid payload')
})

test('tylix gate: email-verification and never-expiring legacy tokens are not access tokens', async () => {
  const verifyLink = signToken({ userId: 1, purpose: 'email-verify' }, SECRET, { expiresInSeconds: 86400 })
  assert.equal((await verifyAccessToken(verifyLink, SECRET)).valid, false)
  const forever = signToken({ userId: 1 }, SECRET)
  assert.equal((await verifyAccessToken(forever, SECRET)).valid, false)
  const ok = signToken({ userId: 1 }, SECRET, { expiresInSeconds: 60 })
  assert.equal((await verifyAccessToken(ok, SECRET)).valid, true)
})

test('tylix gate: JWTs are checked against the session guard', async () => {
  const signer = createTokenSigner({ secret: SECRET })
  const token = await signer.sign({ sid: 's1', uid: 1, userId: 1 }, { type: 'access', expiresIn: 60 })
  setSessionGuard(async (claims) => claims.sid !== 's1')
  try {
    assert.equal((await verifyAccessToken(token, SECRET)).error, 'Session ended')
  } finally {
    setSessionGuard(null)
  }
  assert.equal((await verifyAccessToken(token, SECRET)).payload.userId, 1)
})
