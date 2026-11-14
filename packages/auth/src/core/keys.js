import { base64urlEncode, deriveKeyBytes, importAesKey, importHmacKey } from './crypto.js'

export const MIN_SECRET_LENGTH = 32

const warned = new Set()
function warnOnce(message) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[@tylix/auth] ${message}`)
}

export function isProduction() {
  return globalThis.process?.env?.NODE_ENV === 'production'
}

// Accepts one secret or a list for rotation: the first signs, all of them
// verify. To rotate: put the new secret first, keep the old one until the
// longest-lived token signed with it has expired, then remove it.
export function normalizeSecrets(secret) {
  const list = (Array.isArray(secret) ? secret : [secret]).filter((s) => s != null && s !== '')
  if (list.length === 0) {
    throw new Error('@tylix/auth needs a secret: pass `secret` (for example process.env.AUTH_SECRET). Generate one with: openssl rand -base64 48')
  }
  for (const s of list) {
    if (typeof s !== 'string') throw new TypeError('Auth secrets must be strings.')
    if (s.length < MIN_SECRET_LENGTH) {
      const message = `An auth secret is only ${s.length} characters; use at least ${MIN_SECRET_LENGTH} random characters (openssl rand -base64 48).`
      if (isProduction()) throw new Error(message)
      warnOnce(message)
    }
  }
  return list
}

// Every purpose gets its own key, derived from the secret with HKDF. A
// token made for one purpose (say an email-verification link) can then
// never pass as another (an access token), even if someone forgets to
// check its type: the signature itself is wrong.
export function createKeyring(secret) {
  const secrets = normalizeSecrets(secret)
  const cache = new Map()

  const cached = (key, make) => {
    if (!cache.has(key)) cache.set(key, make())
    return cache.get(key)
  }

  // Key ids are derived too, so they say which secret signed a token
  // without revealing anything about it.
  const kid = (index) =>
    cached(`kid:${index}`, async () => base64urlEncode((await deriveKeyBytes(secrets[index], 'tylix-auth:kid', 9))))

  return {
    size: secrets.length,
    kid,
    hmac: (purpose, index = 0, hash = 'SHA-256') =>
      cached(`hmac:${purpose}:${index}:${hash}`, async () =>
        importHmacKey(await deriveKeyBytes(secrets[index], `tylix-auth:hmac:${purpose}`), hash),
      ),
    aes: (purpose, index = 0) =>
      cached(`aes:${purpose}:${index}`, async () => importAesKey(await deriveKeyBytes(secrets[index], `tylix-auth:aes:${purpose}`))),
    async indexOfKid(value) {
      for (let i = 0; i < secrets.length; i++) if ((await kid(i)) === value) return i
      return -1
    },
  }
}

// --- durations ---------------------------------------------------------

const UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }

/** 900, "900", "15m", "12h", "30d", "2w" -> seconds. */
export function toSeconds(value, name = 'duration') {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  const match = typeof value === 'string' && /^\s*(\d+)\s*([smhdw]?)\s*$/.exec(value)
  if (!match || Number(match[1]) <= 0) throw new TypeError(`Invalid ${name}: ${JSON.stringify(value)} (use seconds or "15m", "12h", "30d")`)
  return Number(match[1]) * (UNITS[match[2] || 's'])
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}
