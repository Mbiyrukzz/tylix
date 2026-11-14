import { hmacSign, importHmacKey, randomBytes, sha256Hex, timingSafeEqual } from '../core/crypto.js'

// Two-factor authentication with authenticator apps (TOTP, RFC 6238) and
// one-time recovery codes. Store the TOTP secret encrypted (auth.sealer)
// and keep the last accepted time step per user: verifyTotp refuses a
// code from that step or earlier, so an intercepted code can't be replayed.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new TypeError('Invalid base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** A new random TOTP secret (base32, 160 bits by default as RFC 4226 recommends). */
export function generateTotpSecret(bytes = 20) {
  if (bytes < 16) throw new RangeError('TOTP secrets need at least 128 bits')
  return base32Encode(randomBytes(bytes))
}

/** The otpauth:// URI to show as a QR code. */
export function totpUri({ secret, issuer, account, digits = 6, period = 30, algorithm = 'SHA1' }) {
  if (!secret || !issuer || !account) throw new TypeError('totpUri needs secret, issuer and account')
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({ secret, issuer, algorithm, digits: String(digits), period: String(period) })
  return `otpauth://totp/${label}?${params}`
}

const HASHES = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

async function hotp(keyBytes, counter, digits, algorithm) {
  const key = await importHmacKey(keyBytes, HASHES[algorithm] ?? 'SHA-1')
  const message = new Uint8Array(8)
  let c = BigInt(counter)
  for (let i = 7; i >= 0; i--) {
    message[i] = Number(c & 0xffn)
    c >>= 8n
  }
  const mac = await hmacSign(key, message)
  const offset = mac[mac.length - 1] & 0x0f
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(binary % 10 ** digits).padStart(digits, '0')
}

export async function generateTotp(secret, { time = Date.now(), digits = 6, period = 30, algorithm = 'SHA1' } = {}) {
  return hotp(base32Decode(secret), Math.floor(time / 1000 / period), digits, algorithm)
}

/**
 * Checks a code. Resolves { valid, step }: store `step` as the user's
 * last used step and pass it back as `lastUsedStep` next time.
 *   window  how many periods either side to accept (default 1 = +-30s)
 */
export async function verifyTotp(code, secret, { time = Date.now(), digits = 6, period = 30, window = 1, algorithm = 'SHA1', lastUsedStep = null } = {}) {
  const normalized = String(code ?? '').replace(/\s+/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return { valid: false, step: null }
  let keyBytes
  try {
    keyBytes = base32Decode(secret)
  } catch {
    return { valid: false, step: null }
  }
  const current = Math.floor(time / 1000 / period)
  let matched = null
  // Every candidate is computed and compared, so timing doesn't reveal
  // which step matched.
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset
    const expected = await hotp(keyBytes, step, digits, algorithm)
    if (timingSafeEqual(expected, normalized) && matched === null) matched = step
  }
  if (matched === null) return { valid: false, step: null }
  if (lastUsedStep != null && matched <= Number(lastUsedStep)) return { valid: false, step: null, replay: true }
  return { valid: true, step: matched }
}

// --- recovery codes ----------------------------------------------------

// No 0/O/1/I/L: codes are read off paper and typed by hand.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function normalizeRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Fresh recovery codes. Show `codes` to the user once; store only `hashes`.
 * Each code has ~50 bits of entropy (10 characters from 31).
 */
export async function generateRecoveryCodes(count = 10) {
  const codes = []
  // Rejection sampling: bytes >= 248 (31 * 8) are skipped, so every
  // character is exactly equally likely.
  const limit = RECOVERY_ALPHABET.length * Math.floor(256 / RECOVERY_ALPHABET.length)
  for (let i = 0; i < count; i++) {
    let raw = ''
    while (raw.length < 10) {
      for (const b of randomBytes(16)) {
        if (b < limit && raw.length < 10) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]
      }
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  const hashes = await Promise.all(codes.map((c) => sha256Hex(`tylix-recovery:${normalizeRecoveryCode(c)}`)))
  return { codes, hashes }
}

/**
 * Index of the stored hash this code matches, or -1. Remove that hash
 * afterwards: every recovery code works once.
 */
export async function verifyRecoveryCode(code, hashes) {
  const normalized = normalizeRecoveryCode(code)
  if (normalized.length !== 10 || !Array.isArray(hashes)) return -1
  const hash = await sha256Hex(`tylix-recovery:${normalized}`)
  let found = -1
  hashes.forEach((stored, index) => {
    if (typeof stored === 'string' && timingSafeEqual(stored, hash) && found === -1) found = index
  })
  return found
}
