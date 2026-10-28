import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const KEY_LENGTH = 64
const PREFIX = 'scrypt'

// New hashes: N=2^15, r=8, p=3 (about 32 MiB per hash, an OWASP-recommended
// scrypt setting). The parameters are stored inside each hash string, so they
// can be raised later without breaking existing hashes.
const COST = 1 << 15
const BLOCK_SIZE = 8
const PARALLELISM = 3

// Sanity limits when reading parameters back from storage, so a corrupted or
// tampered row can't make login allocate gigabytes.
const MAX_COST = 1 << 20
const MAX_BLOCK_SIZE = 32
const MAX_PARALLELISM = 16
const MAX_KEY_LENGTH = 128

function maxmemFor(cost, blockSize, parallelism) {
  return 128 * blockSize * (cost + parallelism + 2) * 2
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 1 && (value & (value - 1)) === 0
}

export async function hashPassword(plainPassword) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: maxmemFor(COST, BLOCK_SIZE, PARALLELISM),
  })
  return `${PREFIX}$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt}$${derivedKey.toString('hex')}`
}

async function verifyCurrent(plainPassword, storedHash) {
  const [, n, r, p, salt, key] = storedHash.split('$')
  const cost = Number(n)
  const blockSize = Number(r)
  const parallelism = Number(p)

  if (
    !salt ||
    !key ||
    !isPowerOfTwo(cost) ||
    cost > MAX_COST ||
    !Number.isInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > MAX_BLOCK_SIZE ||
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > MAX_PARALLELISM
  ) {
    return false
  }

  const keyBuffer = Buffer.from(key, 'hex')
  if (keyBuffer.length === 0 || keyBuffer.length > MAX_KEY_LENGTH) return false

  const derivedKey = await scrypt(plainPassword, salt, keyBuffer.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: maxmemFor(cost, blockSize, parallelism),
  })

  if (derivedKey.length !== keyBuffer.length) return false
  return timingSafeEqual(derivedKey, keyBuffer)
}

// Hashes created before parameters were stored: "salt:key", Node's default
// scrypt settings. Still accepted so nobody is locked out; the login flow
// upgrades them to the current format after a successful login.
async function verifyLegacy(plainPassword, storedHash) {
  const [salt, key] = storedHash.split(':')
  if (!salt || !key) return false

  const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH)
  const keyBuffer = Buffer.from(key, 'hex')

  // derivedKey and keyBuffer must be equal length for timingSafeEqual,
  // or it throws -- guard against a corrupted/foreign-format stored
  // hash rather than letting a length mismatch crash the login route.
  if (derivedKey.length !== keyBuffer.length) return false

  return timingSafeEqual(derivedKey, keyBuffer)
}

export async function verifyPassword(plainPassword, storedHash) {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false

  if (storedHash.startsWith(`${PREFIX}$`)) {
    return verifyCurrent(plainPassword, storedHash)
  }

  return verifyLegacy(plainPassword, storedHash)
}