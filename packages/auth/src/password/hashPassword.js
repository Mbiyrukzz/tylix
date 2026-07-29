import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

export async function hashPassword(plainPassword) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH)
  return `${salt}:${derivedKey.toString('hex')}`
}

export async function verifyPassword(plainPassword, storedHash) {
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
