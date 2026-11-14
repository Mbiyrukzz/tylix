import { base64urlDecode, base64urlEncode, fromUtf8, hmacSign, hmacVerify, randomToken } from '../core/crypto.js'
import { createKeyring, nowSeconds, toSeconds } from '../core/keys.js'

// Standard compact JWTs (HS256), hardened:
//   - the algorithm is pinned: "none", RS/ES and alg-confusion tricks fail
//   - every token has a type ("access", "email-verify", ...) carried in the
//     header AND bound into the key, so one kind can never pass as another
//   - exp is required; nbf/iat in the future are refused (with a little
//     clock tolerance); iss/aud are checked when configured
//   - key ids select the right secret during rotation
//   - oversized tokens are refused before any work is done
//   - verify() never throws: it answers { valid, payload, error }

const RESERVED_TYPE = /^[a-z][a-z0-9-]{0,39}$/
const MAX_TOKEN_LENGTH = 8192

function fail(error) {
  return { valid: false, payload: null, error }
}

function decodeJson(segment) {
  const value = JSON.parse(fromUtf8(base64urlDecode(segment)))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('not an object')
  return value
}

export function createTokenSigner({
  secret,
  keyring = createKeyring(secret),
  issuer,
  audience,
  clockToleranceSeconds = 5,
  maxTokenLength = MAX_TOKEN_LENGTH,
} = {}) {
  const keyFor = (type, index) => keyring.hmac(`jwt:${type}`, index)

  function checkType(type) {
    if (!RESERVED_TYPE.test(type)) throw new TypeError(`Invalid token type ${JSON.stringify(type)}: use lowercase letters, digits and dashes.`)
  }

  async function sign(claims = {}, { type = 'access', expiresIn, notBefore, jwtId = true, subject } = {}) {
    checkType(type)
    if (expiresIn == null) throw new TypeError('sign() needs expiresIn: tokens that never expire are refused.')
    if (claims == null || typeof claims !== 'object' || Array.isArray(claims)) throw new TypeError('Token claims must be an object.')

    const now = nowSeconds()
    const payload = { ...claims, iat: now, exp: now + toSeconds(expiresIn, 'expiresIn') }
    if (subject != null) payload.sub = String(subject)
    if (notBefore != null) payload.nbf = now + toSeconds(notBefore, 'notBefore')
    if (jwtId && payload.jti == null) payload.jti = randomToken(16)
    if (issuer && payload.iss == null) payload.iss = issuer
    if (audience && payload.aud == null) payload.aud = Array.isArray(audience) ? audience[0] : audience

    const header = { alg: 'HS256', typ: `${type}+jwt`, kid: await keyring.kid(0) }
    const signingInput = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`
    const signature = await hmacSign(await keyFor(type, 0), signingInput)
    return `${signingInput}.${base64urlEncode(signature)}`
  }

  async function verify(token, { type = 'access', issuer: expectedIssuer = issuer, audience: expectedAudience = audience, maxAgeSeconds } = {}) {
    try {
      checkType(type)
    } catch {
      return fail('Invalid token type')
    }
    if (typeof token !== 'string' || token.length === 0) return fail('Malformed token')
    if (token.length > maxTokenLength) return fail('Token too large')

    const parts = token.split('.')
    if (parts.length !== 3) return fail('Malformed token')
    const [headerB64, payloadB64, signatureB64] = parts

    let header, signature
    try {
      header = decodeJson(headerB64)
      signature = base64urlDecode(signatureB64)
    } catch {
      return fail('Malformed token')
    }

    if (header.alg !== 'HS256') return fail('Unsupported algorithm')
    if (header.typ !== `${type}+jwt`) return fail('Wrong token type')
    if ('crit' in header) return fail('Unsupported token header')

    // With a key id, only that secret is tried; an unknown id is refused
    // rather than tried against every key.
    let indexes
    if (header.kid !== undefined) {
      const index = typeof header.kid === 'string' ? await keyring.indexOfKid(header.kid) : -1
      if (index === -1) return fail('Unknown signing key')
      indexes = [index]
    } else {
      indexes = Array.from({ length: keyring.size }, (_, i) => i)
    }

    const signingInput = `${headerB64}.${payloadB64}`
    let verified = false
    for (const index of indexes) {
      if (await hmacVerify(await keyFor(type, index), signature, signingInput)) {
        verified = true
        break
      }
    }
    if (!verified) return fail('Invalid signature')

    let payload
    try {
      payload = decodeJson(payloadB64)
    } catch {
      return fail('Invalid payload')
    }

    const now = nowSeconds()
    const tolerance = clockToleranceSeconds
    if (!Number.isFinite(payload.exp)) return fail('Token has no expiry')
    if (now - tolerance >= payload.exp) return fail('Token expired')
    if (payload.nbf != null && (!Number.isFinite(payload.nbf) || payload.nbf > now + tolerance)) return fail('Token not yet valid')
    if (payload.iat != null && (!Number.isFinite(payload.iat) || payload.iat > now + tolerance)) return fail('Token issued in the future')
    if (maxAgeSeconds != null && (!Number.isFinite(payload.iat) || now - payload.iat > toSeconds(maxAgeSeconds, 'maxAgeSeconds'))) {
      return fail('Token too old')
    }
    if (expectedIssuer && payload.iss !== expectedIssuer) return fail('Wrong issuer')
    if (expectedAudience) {
      const wanted = Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience]
      const got = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
      if (!got.some((a) => wanted.includes(a))) return fail('Wrong audience')
    }

    return { valid: true, payload, error: null }
  }

  return { sign, verify }
}

/** Reads a JWT's claims WITHOUT checking anything. Never use the result for access decisions. */
export function decodeTokenUnsafe(token) {
  try {
    const parts = String(token).split('.')
    if (parts.length !== 3) return null
    return { header: decodeJson(parts[0]), payload: decodeJson(parts[1]) }
  } catch {
    return null
  }
}
