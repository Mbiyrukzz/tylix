import { subtle, toHex, utf8 } from '../core/crypto.js'

// Password rules in the spirit of NIST SP 800-63B: length matters, forced
// "one symbol and one digit" rules don't. Instead, reject what attackers
// try first: very common passwords, passwords built from the user's own
// name or email, trivial patterns, and (optionally) any password already
// seen in a public breach.

// The most common passwords from public breach corpora (lowercased). A
// short list on purpose: it catches what credential-stuffing tries first,
// and the breach check below covers the long tail.
const COMMON = new Set(`
123456 123456789 12345678 password qwerty123 qwerty 12345 1234567 111111 123123 abc123 password1 1234567890
000000 iloveyou 1q2w3e4r 1qaz2wsx qwertyuiop 654321 666666 987654321 121212 123321 7777777 112233
dragon monkey letmein football baseball welcome admin login master hello freedom whatever shadow
sunshine princess trustno1 starwars passw0rd password123 superman batman michael jennifer charlie
donald zaq12wsx asdfghjkl asdfgh qazwsx 1q2w3e 1q2w3e4r5t q1w2e3r4 aa123456 qwer1234 abcd1234 a123456
123qwe 123abc admin123 root toor changeme default secret letmein1 welcome1 welcome123 password! p@ssw0rd
p@ssword pa$$word passwort motdepasse contraseña senha 11111111 00000000 88888888 12341234 123654
1111111111 zxcvbnm zxcvbnm123 asdf1234 qwerty1 iloveyou1 princess1 football1 monkey123 dragon123
mustang access hunter2 ninja azerty solo loveme flower hottie lovely 696969 baseball1 jordan23
computer internet samsung google apple1 tylix tylix123 testtest test1234 test123 guest guest123
summer2024 winter2024 spring2024 autumn2024 summer2025 winter2025 summer2026 winter2026 spring2026
`.split(/\s+/).filter(Boolean))

function isSequential(value) {
  if (value.length < 4) return false
  let up = true
  let down = true
  for (let i = 1; i < value.length; i++) {
    const d = value.charCodeAt(i) - value.charCodeAt(i - 1)
    if (d !== 1) up = false
    if (d !== -1) down = false
  }
  return up || down
}

function contextualParts(inputs) {
  const parts = new Set()
  for (const input of inputs) {
    if (typeof input !== 'string') continue
    const lower = input.toLowerCase()
    const local = lower.split('@')[0]
    for (const piece of [local, ...lower.split(/[^a-z0-9]+/i)]) if (piece.length >= 4) parts.add(piece)
  }
  return [...parts]
}

/**
 * Checks a new password. Resolves { ok, errors: string[] }.
 *   minLength   default 8 (NIST: 8 with MFA, 15 for password-only accounts)
 *   maxLength   default 128 characters
 *   userInputs  the user's name, email, username... (never allowed inside)
 *   breached    true to also check Have I Been Pwned (k-anonymity; only a
 *               5-character hash prefix leaves the server). Fails open.
 */
export async function checkPasswordStrength(password, { minLength = 8, maxLength = 128, userInputs = [], breached = false, fetch: fetchImpl } = {}) {
  const errors = []
  if (typeof password !== 'string') return { ok: false, errors: ['Choose a password.'] }

  const length = [...password].length
  if (length < minLength) errors.push(`Password must be at least ${minLength} characters.`)
  if (length > maxLength) errors.push(`Password must be at most ${maxLength} characters.`)

  const lower = password.toLowerCase()
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[!@#$.]+$/, ''))) {
    errors.push('This password is too common. Choose something less predictable.')
  } else if (/^(.)\1+$/.test(password) || isSequential(lower)) {
    errors.push('Avoid repeated or sequential characters.')
  }

  if (contextualParts(userInputs).some((part) => lower.includes(part))) {
    errors.push("Don't use your name or email address in your password.")
  }

  if (errors.length === 0 && breached) {
    const count = await breachCount(password, { fetch: fetchImpl })
    if (count > 0) errors.push('This password has appeared in a data breach. Choose a different one.')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * How many times a password appears in Have I Been Pwned's breach corpus.
 * Uses the range API: only the first 5 hex characters of the SHA-1 are
 * sent, with response padding on. Resolves 0 on any network failure so a
 * third-party outage never blocks sign-ups.
 */
export async function breachCount(password, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  try {
    const hash = toHex(new Uint8Array(await subtle().digest('SHA-1', utf8(password)))).toUpperCase()
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': '@tylix/auth' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return 0
    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':')
      if (candidate === suffix) return Number(count) || 0
    }
    return 0
  } catch {
    return 0
  }
}
