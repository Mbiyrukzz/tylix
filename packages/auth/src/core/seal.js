import { aesGcmDecrypt, aesGcmEncrypt, base64urlDecode, base64urlEncode, fromUtf8, randomBytes } from './crypto.js'
import { createKeyring, nowSeconds, toSeconds } from './keys.js'

// Authenticated encryption (AES-256-GCM) for values that must stay secret
// AND untampered: OAuth state cookies, TOTP secrets in the database, any
// small server-side value you hand to the browser.
//
//   v1.<kid>.<iv>.<ciphertext>
//
// The purpose is bound in as additional data, so a value sealed for one
// purpose fails to open as another. An optional expiry is sealed inside.

export function createSealer({ secret, keyring = createKeyring(secret) } = {}) {
  async function seal(value, { purpose = 'default', expiresIn } = {}) {
    const body = { v: value }
    if (expiresIn != null) body.exp = nowSeconds() + toSeconds(expiresIn, 'expiresIn')
    const iv = randomBytes(12)
    const ciphertext = await aesGcmEncrypt(await keyring.aes(`seal:${purpose}`, 0), iv, JSON.stringify(body), purpose)
    return `v1.${await keyring.kid(0)}.${base64urlEncode(iv)}.${base64urlEncode(ciphertext)}`
  }

  // Resolves the original value, or null for anything forged, altered,
  // expired, sealed for another purpose, or with an unknown key.
  async function unseal(sealed, { purpose = 'default' } = {}) {
    if (typeof sealed !== 'string' || sealed.length > 16384) return null
    const parts = sealed.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') return null
    try {
      const index = await keyring.indexOfKid(parts[1])
      if (index === -1) return null
      const iv = base64urlDecode(parts[2])
      if (iv.length !== 12) return null
      const plaintext = await aesGcmDecrypt(await keyring.aes(`seal:${purpose}`, index), iv, base64urlDecode(parts[3]), purpose)
      const body = JSON.parse(fromUtf8(plaintext))
      if (body.exp != null && nowSeconds() >= body.exp) return null
      return body.v
    } catch {
      return null
    }
  }

  return { seal, unseal }
}
