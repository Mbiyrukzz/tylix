export * from './web.js'
export * from './password/hashPassword.js'
export * from './token/signToken.js'
export * from './cookies/authCookies.js'
export * from './rateLimiter/loginRateLimiter.js'
export * from './generators/AuthGenerator.js'

import type { VerifyResult } from './web.js'
/** The check @tylix/core's requireAuth runs: session JWTs (with the session guard) and legacy access tokens. */
export declare function verifyTylixAccessToken(token: string, secret: string | string[]): Promise<VerifyResult>
/** Registers (fn) or clears (null) the check that a token's session still exists. */
export declare function setSessionGuard(fn: ((claims: Record<string, any>) => boolean | Promise<boolean>) | null): void
export declare function getSessionGuard(): ((claims: Record<string, any>) => boolean | Promise<boolean>) | null
