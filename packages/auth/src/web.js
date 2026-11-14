// Edge-safe entry: Web Crypto and Web standards only, no node:* imports.
// Runs on Node, Bun, Deno, Cloudflare Workers, Vercel/Next.js edge.
// (Password hashing needs node:crypto's scrypt: import it from
// "@tylix/auth" or "@tylix/auth/password" in server code.)

export { createAuth } from './session/createAuth.js'
export { memoryAdapter } from './session/adapters/memory.js'
export { keyValueAdapter } from './session/adapters/keyValue.js'
export { sqlAdapter, createTableSql } from './session/adapters/sql.js'
export { prismaAdapter } from './session/adapters/prisma.js'
export { modelAdapter } from './session/adapters/model.js'

export { createTokenSigner, decodeTokenUnsafe } from './token/jwt.js'
export { createSealer } from './core/seal.js'
export { createKeyring, normalizeSecrets, toSeconds, MIN_SECRET_LENGTH } from './core/keys.js'
export { randomToken, timingSafeEqual, sha256Hex, base64urlEncode, base64urlDecode } from './core/crypto.js'

export { parseCookieHeader, parseCookieHeaderAll, serializeCookie, expireCookie } from './http/cookies.js'
export {
  applyCookies,
  cookieHeaders,
  getClientIp,
  getCookie,
  getHeader,
  isSecureRequest,
} from './http/request.js'
export { isCrossSiteRequest, safeRedirectPath } from './http/origin.js'

export { createRateLimiter, createLoginThrottle, createMemoryCounterStore } from './ratelimit/limiter.js'
export { checkPasswordStrength, breachCount } from './password/policy.js'

export {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  totpUri,
  generateRecoveryCodes,
  verifyRecoveryCode,
  base32Encode,
  base32Decode,
} from './mfa/totp.js'

export { createOAuth, OAuthError } from './oauth/oauth.js'
export { oauthProvider, github, google, discord, gitlab, microsoft } from './oauth/providers.js'

export { handleAuthRoute } from './integrations/routes.js'
export { createAuthHandler, jsonWithCookies, redirectWithCookies, withSession, guardRequest } from './integrations/web.js'
