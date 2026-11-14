import { createTokenSigner } from '../token/jwt.js'
import { verifyToken } from '../token/signToken.js'

// What @tylix/core's requireAuth uses to check a request's token. Accepts:
//   - JWT access tokens from createAuth() sessions (current controllers)
//   - legacy two-part tokens (older controllers, the test helper), but
//     only real access tokens: anything carrying a purpose (an email
//     verification link, say) or without an expiry is refused
//
// When the app's AuthController has registered a session guard, a JWT is
// only accepted while its session exists, so logout, "sign out
// everywhere" and password resets end access immediately.

const GUARD = Symbol.for('tylix.auth.sessionGuard')
const signers = new Map()

function signerFor(secret) {
  const key = Array.isArray(secret) ? secret.join('\u0000') : secret
  if (!signers.has(key)) signers.set(key, createTokenSigner({ secret }))
  return signers.get(key)
}

/** Registers (fn) or clears (null) the check that a token's session still exists. */
export function setSessionGuard(fn) {
  globalThis[GUARD] = typeof fn === 'function' ? fn : null
}

export function getSessionGuard() {
  return globalThis[GUARD] ?? null
}

function fail(error) {
  return { valid: false, payload: null, error }
}

export async function verifyAccessToken(token, secret) {
  if (typeof token !== 'string' || token.length === 0) return fail('Malformed token')
  if (!secret) return fail('No secret configured')

  const segments = token.split('.').length
  if (segments === 3) {
    const result = await signerFor(secret).verify(token, { type: 'access' })
    if (!result.valid) return result
    const guard = getSessionGuard()
    if (guard && typeof result.payload.sid === 'string' && !(await guard(result.payload))) {
      return fail('Session ended')
    }
    return result
  }

  if (segments === 2) {
    const primary = Array.isArray(secret) ? secret[0] : secret
    const result = verifyToken(token, primary)
    if (!result.valid) return result
    if (result.payload.purpose != null || result.payload.typ != null) return fail('Wrong token type')
    if (!Number.isFinite(result.payload.exp)) return fail('Token has no expiry')
    return result
  }

  return fail('Malformed token')
}
