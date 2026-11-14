import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

// Password hashing with scrypt (memory-hard), using node:crypto, which Node,
// Bun, Deno and Cloudflare Workers (nodejs_compat) all provide.
//
//   scrypt$<N>$<r>$<p>$<salt>$<key>
//
// The parameters live in each hash, so they can be raised later: call
// needsRehash() after a successful login and store a fresh hash when it
// says so (the generated Tylix controller does).

const scrypt = promisify(scryptCallback)

const KEY_LENGTH = 64
const PREFIX = 'scrypt'

// N=2^15, r=8, p=3: about 32 MiB per hash, an OWASP-recommended setting.
const COST = 1 << 15
const BLOCK_SIZE = 8
const PARALLELISM = 3

// Sanity limits when reading parameters back from storage, so a corrupted or
// tampered row can't make login allocate gigabytes.
const MAX_COST = 1 << 20
const MAX_BLOCK_SIZE = 32
const MAX_PARALLELISM = 16
const MAX_KEY_LENGTH = 128

// Longer inputs are refused outright: hashing megabytes per request is a
// cheap way to burn CPU, and no real password is this long.
export const MAX_PASSWORD_BYTES = 1024

function maxmemFor(cost, blockSize, parallelism) {
  return 128 * blockSize * (cost + parallelism + 2) * 2
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 1 && (value & (value - 1)) === 0
}

function tooLong(value) {
  return Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES
}

// The same password typed on different keyboards can arrive as different
// Unicode sequences ("é" as one code point or as "e" + accent). NFC makes
// them one, so nobody is locked out by their input method.
function normalize(value) {
  return value.normalize('NFC')
}

export async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new TypeError('hashPassword needs a non-empty string.')
  }
  if (tooLong(plainPassword)) throw new RangeError(`Passwords are limited to ${MAX_PASSWORD_BYTES} bytes.`)
  const salt = randomBytes(16).toString('hex')
  const derivedKey = await scrypt(normalize(plainPassword), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: maxmemFor(COST, BLOCK_SIZE, PARALLELISM),
  })
  return `${PREFIX}$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt}$${derivedKey.toString('hex')}`
}

function parseCurrent(storedHash) {
  const parts = storedHash.split('$')
  if (parts.length !== 6) return null
  const [, n, r, p, salt, key] = parts
  const cost = Number(n)
  const blockSize = Number(r)
  const parallelism = Number(p)
  if (
    !/^[0-9a-f]{16,128}$/i.test(salt) ||
    !/^[0-9a-f]+$/i.test(key) ||
    !isPowerOfTwo(cost) ||
    cost > MAX_COST ||
    !Number.isInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > MAX_BLOCK_SIZE ||
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > MAX_PARALLELISM
  ) {
    return null
  }
  const keyBuffer = Buffer.from(key, 'hex')
  if (keyBuffer.length < 16 || keyBuffer.length > MAX_KEY_LENGTH) return null
  return { cost, blockSize, parallelism, salt, keyBuffer }
}

async function derive(password, { cost, blockSize, parallelism, salt, keyBuffer }) {
  return scrypt(password, salt, keyBuffer.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: maxmemFor(cost, blockSize, parallelism),
  })
}

async function verifyCurrent(plainPassword, storedHash) {
  const parsed = parseCurrent(storedHash)
  if (!parsed) return false

  const normalized = normalize(plainPassword)
  const derived = await derive(normalized, parsed)
  if (timingSafeEqual(derived, parsed.keyBuffer)) return true

  // Hashes made before normalization was added used the raw input.
  if (normalized !== plainPassword) {
    return timingSafeEqual(await derive(plainPassword, parsed), parsed.keyBuffer)
  }
  return false
}

// Hashes created before parameters were stored: "salt:key", Node's default
// scrypt settings. Still accepted so nobody is locked out; needsRehash()
// is true for them, so the login flow replaces them.
async function verifyLegacy(plainPassword, storedHash) {
  const [salt, key, extra] = storedHash.split(':')
  if (!salt || !key || extra !== undefined || !/^[0-9a-f]+$/i.test(key)) return false

  const keyBuffer = Buffer.from(key, 'hex')
  if (keyBuffer.length !== KEY_LENGTH) return false

  const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH)
  return timingSafeEqual(derivedKey, keyBuffer)
}

// A real hash of a random password, made once. Verifying against it costs
// what a real verification costs, which is the point: see verifyPassword.
let dummyHash = null
function getDummyHash() {
  dummyHash ??= hashPassword(randomBytes(24).toString('hex'))
  return dummyHash
}

/**
 * Checks a password against a stored hash. Always resolves a boolean.
 *
 * Pass `null`/`undefined` as the hash when the account doesn't exist: the
 * same scrypt work is still done against a dummy hash, so the response
 * time doesn't reveal which emails are registered.
 */
export async function verifyPassword(plainPassword, storedHash) {
  const hasHash = typeof storedHash === 'string' && storedHash.length > 0

  if (typeof plainPassword !== 'string' || plainPassword.length === 0 || tooLong(plainPassword) || !hasHash) {
    await verifyCurrent(randomBytes(12).toString('hex'), await getDummyHash())
    return false
  }

  try {
    if (storedHash.startsWith(`${PREFIX}$`)) return await verifyCurrent(plainPassword, storedHash)
    return await verifyLegacy(plainPassword, storedHash)
  } catch {
    return false
  }
}

/** True when a stored hash uses an old format or weaker parameters than current ones. */
export function needsRehash(storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith(`${PREFIX}$`)) return true
  const parsed = parseCurrent(storedHash)
  if (!parsed) return true
  return parsed.cost < COST || parsed.blockSize < BLOCK_SIZE || parsed.parallelism < PARALLELISM || parsed.keyBuffer.length < KEY_LENGTH
}
