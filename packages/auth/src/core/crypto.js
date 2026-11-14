// Web Crypto helpers. Everything here runs unchanged on Node 22+, Bun,
// Deno, Cloudflare Workers, Vercel/Next.js edge and browsers: nothing
// imports node:crypto or relies on Buffer.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function webcrypto() {
  const c = globalThis.crypto
  if (!c?.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('@tylix/auth needs the Web Crypto API (globalThis.crypto.subtle). Use Node 22+ or another runtime that provides it.')
  }
  return c
}

export function utf8(value) {
  return typeof value === 'string' ? encoder.encode(value) : value
}

export function fromUtf8(bytes) {
  return decoder.decode(bytes)
}

// --- base64url (RFC 4648 section 5, no padding) ---------------------------

export function base64urlEncode(input) {
  const bytes = utf8(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const BASE64URL = /^[A-Za-z0-9_-]*$/

// Strict: rejects padding, foreign characters and non-canonical encodings
// (where the unused low bits of the last character are not zero). Without
// the canonical check, several different strings decode to the same bytes,
// so a signed token could be altered without breaking its signature.
export function base64urlDecode(input) {
  if (typeof input !== 'string' || !BASE64URL.test(input) || input.length % 4 === 1) {
    throw new TypeError('Invalid base64url')
  }
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (base64urlEncode(bytes) !== input) throw new TypeError('Non-canonical base64url')
  return bytes
}

// --- randomness -------------------------------------------------------------

export function randomBytes(length) {
  const bytes = new Uint8Array(length)
  webcrypto().getRandomValues(bytes)
  return bytes
}

/** A URL- and cookie-safe random string with `bytes` bytes of entropy (default 32 = 256 bits). */
export function randomToken(bytes = 32) {
  return base64urlEncode(randomBytes(bytes))
}

// --- hashing ----------------------------------------------------------------

export async function sha256(input) {
  return new Uint8Array(await webcrypto().subtle.digest('SHA-256', utf8(input)))
}

export function toHex(bytes) {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export async function sha256Hex(input) {
  return toHex(await sha256(input))
}

// --- constant-time comparison -------------------------------------------

/** Compares two byte arrays or strings without an early exit. Only the length can leak. */
export function timingSafeEqual(a, b) {
  const x = utf8(a)
  const y = utf8(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

// --- keys -------------------------------------------------------------------

// A fixed, public salt: HKDF's security here comes from the secret, the
// salt only separates Tylix's derivations from anything else using the
// same secret.
const HKDF_SALT = utf8('tylix-auth/v2')

export async function deriveKeyBytes(secret, info, length = 32) {
  const subtle = webcrypto().subtle
  const base = await subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: utf8(info) },
    base,
    length * 8,
  )
  return new Uint8Array(bits)
}

export async function importHmacKey(rawBytes, hash = 'SHA-256') {
  return webcrypto().subtle.importKey('raw', rawBytes, { name: 'HMAC', hash }, false, ['sign', 'verify'])
}

export async function hmacSign(key, data) {
  return new Uint8Array(await webcrypto().subtle.sign('HMAC', key, utf8(data)))
}

// subtle.verify compares in constant time.
export async function hmacVerify(key, signature, data) {
  return webcrypto().subtle.verify('HMAC', key, signature, utf8(data))
}

export async function importAesKey(rawBytes) {
  return webcrypto().subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function aesGcmEncrypt(key, iv, plaintext, additionalData) {
  return new Uint8Array(
    await webcrypto().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(additionalData) }, key, utf8(plaintext)),
  )
}

export async function aesGcmDecrypt(key, iv, ciphertext, additionalData) {
  return new Uint8Array(
    await webcrypto().subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(additionalData) }, key, ciphertext),
  )
}

export function subtle() {
  return webcrypto().subtle
}
