import { createHmac, timingSafeEqual } from 'node:crypto'

// The original Tylix token format: "<base64url payload>.<HMAC-SHA256>".
// Synchronous and kept for compatibility (existing sessions, the test
// helper, apps generated before 1.5). New code should use createAuth()
// sessions or createTokenSigner() JWTs, which add token types, key
// rotation, per-purpose keys and mandatory expiry.

const MAX_TOKEN_LENGTH = 8192
const BASE64URL = /^[A-Za-z0-9_-]+$/

function base64url(input) {
  return Buffer.from(input).toString('base64url')
}

function sign(payloadB64, secret) {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

function fail(error) {
  return { valid: false, payload: null, error }
}

export function signToken(payload, secret, { expiresInSeconds } = {}) {
  if (!secret) throw new TypeError('signToken needs a secret')
  const body = { ...payload }
  if (expiresInSeconds) {
    body.exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  }

  const payloadB64 = base64url(JSON.stringify(body))
  const signature = sign(payloadB64, secret)
  return `${payloadB64}.${signature}`
}

export function verifyToken(token, secret) {
  if (!secret) return fail('No secret configured')
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return fail('Malformed token')

  // Exactly two canonical base64url segments: trailing segments or
  // alternative encodings of the same bytes are refused.
  const parts = token.split('.')
  if (parts.length !== 2) return fail('Malformed token')
  const [payloadB64, signature] = parts
  if (!BASE64URL.test(payloadB64) || !BASE64URL.test(signature)) return fail('Malformed token')

  const sigBuffer = Buffer.from(signature, 'base64url')
  if (sigBuffer.toString('base64url') !== signature) return fail('Malformed token')
  const expectedBuffer = Buffer.from(sign(payloadB64, secret), 'base64url')

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return fail('Invalid signature')
  }

  let payload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
  } catch {
    return fail('Invalid payload')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('Invalid payload')

  if (payload.exp != null && (!Number.isFinite(payload.exp) || Math.floor(Date.now() / 1000) >= payload.exp)) {
    return fail('Token expired')
  }

  return { valid: true, payload, error: null }
}
