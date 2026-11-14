// Types for "@tylix/auth/web" (edge-safe) and re-exported by "@tylix/auth".

/** Anything a framework calls a request: Web Request, Headers, Node/Express/Fastify req, Koa ctx, h3 event, SvelteKit event, Hono context. */
export type RequestLike = Request | Headers | { headers: unknown; [key: string]: any } | { request: unknown } | { req: unknown } | { node: { req: unknown } } | Record<string, any>
/** Anything Set-Cookie headers can be written to: Headers, Response, Node/Express res, Fastify reply, Koa ctx, Hono context, h3 event. */
export type ResponseLike = Headers | Response | Record<string, any>
/** Seconds, or "30s", "15m", "12h", "30d", "2w". */
export type Duration = number | string
export type Secret = string | string[]
export type UserId = string | number

// --- sessions ----------------------------------------------------------------

export interface SessionRecord {
  id: string
  userId: UserId
  tokenHash: string
  prevTokenHash: string | null
  rotatedAt: number | null
  createdAt: number
  lastUsedAt: number
  expiresAt: number
  idleExpiresAt: number | null
  persistent: boolean
  ip: string | null
  userAgent: string | null
  data: unknown
}

export type PublicSession = Omit<SessionRecord, 'tokenHash' | 'prevTokenHash' | 'rotatedAt'> & { current?: boolean }

/** Where sessions are stored. Implement this to use any database. */
export interface SessionAdapter {
  ephemeral?: boolean
  create(record: SessionRecord): Promise<void>
  get(id: string): Promise<SessionRecord | null>
  /** With expectTokenHash, must update only if the stored tokenHash still equals it (compare-and-swap) and resolve whether it did. */
  update(id: string, patch: Partial<SessionRecord>, options?: { expectTokenHash?: string }): Promise<boolean>
  delete(id: string): Promise<void>
  deleteByUser(userId: UserId, options?: { exceptId?: string }): Promise<number>
  listByUser(userId: UserId): Promise<SessionRecord[]>
}

export interface AuthEvent {
  type: 'session.created' | 'session.refreshed' | 'session.revoked' | 'session.revoked_all' | 'session.expired' | 'session.rejected' | 'session.reuse_detected'
  at: string
  sessionId?: string
  userId?: UserId
  [key: string]: unknown
}

export interface CreateAuthOptions {
  /** One secret, or several for rotation (the first signs, all verify). At least 32 characters. */
  secret: Secret
  /** Where sessions live. Default: memory (single process, dev only). */
  adapter?: SessionAdapter
  issuer?: string
  audience?: string | string[]
  /** Default "15m". */
  accessTokenTtl?: Duration
  /** Absolute session lifetime for "remember me" logins. Default "30d". */
  sessionTtl?: Duration
  /** Absolute lifetime when persistent: false. Default "1d". */
  shortSessionTtl?: Duration
  /** Ends sessions unused for this long. Default "14d". */
  idleTimeout?: Duration
  /** How long a just-rotated refresh token still works (parallel tabs). Default "30s". */
  rotationGrace?: Duration
  /** Believe X-Forwarded-* headers. Only behind a proxy you control. */
  trustProxy?: boolean
  /** Other origins allowed to make cookie-authenticated writes. */
  trustedOrigins?: string[]
  /** getSession() looks the session up, so revocation is immediate. Default true. */
  checkRevocation?: boolean
  /** Accept "Authorization: Bearer". Default true. */
  allowBearer?: boolean
  /** Refuse cookie-authenticated cross-site writes. Default true. */
  csrf?: boolean
  storeIp?: boolean
  storeUserAgent?: boolean
  cookies?: {
    accessName?: string
    refreshName?: string
    /** Use __Host-/__Secure- prefixes on HTTPS. Default true. */
    prefix?: boolean
    /** Path of the refresh cookie; must cover your refresh and logout routes. Default "/api/auth". */
    refreshPath?: string
    sameSite?: 'lax' | 'strict' | 'none'
    domain?: string
    /** Default "auto": on for HTTPS requests and in production. */
    secure?: boolean | 'auto'
    /** Old refresh-cookie paths to expire whenever the cookie is set. */
    legacyRefreshPaths?: string[]
  }
  /** Extra claims for access tokens. */
  claims?: (session: PublicSession) => Record<string, unknown> | Promise<Record<string, unknown>>
  /** Called at every refresh; return false to end the session (banned user, ...). */
  validateSession?: (session: PublicSession) => boolean | Promise<boolean>
  /** Audit hook. Errors thrown here are ignored. */
  onEvent?: (event: AuthEvent) => unknown
}

export interface AccessClaims {
  sub: string
  sid: string
  uid: UserId
  iat: number
  exp: number
  jti: string
  [key: string]: unknown
}

export interface CurrentSession {
  userId: UserId
  sessionId: string
  claims: AccessClaims
  /** null when checkRevocation is off. */
  session: PublicSession | null
  via: 'cookie' | 'bearer'
}

export interface SignInResult {
  session: PublicSession
  accessToken: string
  refreshToken: string
  /** Set-Cookie header values: send them with the response (see applyCookies). */
  cookies: string[]
}

export type RefreshResult =
  | { ok: true; session: PublicSession; accessToken: string; refreshToken: string | null; cookies: string[] }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'reused' | 'revoked' | 'rejected' | 'cross-site'; cookies: string[] }

export interface Auth {
  signIn(request: RequestLike | null, userId: UserId, options?: { persistent?: boolean; data?: unknown }): Promise<SignInResult>
  signOut(request: RequestLike): Promise<{ ok: true; sessionId: string | null; cookies: string[] }>
  refresh(request: RequestLike): Promise<RefreshResult>
  getSession(request: RequestLike, options?: { checkRevocation?: boolean }): Promise<CurrentSession | null>
  verifyAccessToken(token: string): Promise<AccessClaims | null>
  revokeSession(sessionId: string): Promise<boolean>
  revokeAllSessions(userId: UserId, options?: { exceptSessionId?: string }): Promise<number>
  listSessions(userId: UserId, options?: { currentSessionId?: string }): Promise<PublicSession[]>
  updateSessionData(sessionId: string, data: unknown): Promise<boolean>
  isSessionActive(sessionId: string, userId?: UserId): Promise<boolean>
  clearCookies(request?: RequestLike | null): string[]
  cookieNames(request?: RequestLike | null): { access: string; refresh: string; secure: boolean }
  isCrossSite(request: RequestLike): boolean
  tokens: TokenSigner
  sealer: Sealer
  adapter: SessionAdapter
  options: { accessTokenTtl: number; refreshPath: string; trustProxy: boolean; trustedOrigins: string[] }
}

export declare function createAuth(options: CreateAuthOptions): Auth

export declare function memoryAdapter(): SessionAdapter
export declare function keyValueAdapter(
  store: { get(key: string): Promise<unknown>; set(key: string, value: string, options?: { ttlMs?: number }): Promise<unknown>; delete(key: string): Promise<unknown> },
  options?: { prefix?: string },
): SessionAdapter
export declare function sqlAdapter(options: {
  query: (sql: string, params: unknown[]) => Promise<unknown>
  dialect?: 'postgres' | 'mysql' | 'sqlite'
  table?: string
}): SessionAdapter
export declare function createTableSql(options?: { table?: string; dialect?: 'postgres' | 'mysql' | 'sqlite' }): string[]
export declare function prismaAdapter(delegate: any): SessionAdapter
export declare function modelAdapter(Model: any): SessionAdapter

// --- tokens & sealing --------------------------------------------------------

export interface VerifyResult<T = Record<string, unknown>> {
  valid: boolean
  payload: (T & { iat?: number; exp: number; sub?: string; jti?: string }) | null
  error: string | null
}

export interface TokenSigner {
  sign(claims?: Record<string, unknown>, options?: { type?: string; expiresIn: Duration; notBefore?: Duration; jwtId?: boolean; subject?: UserId }): Promise<string>
  verify<T = Record<string, unknown>>(token: string, options?: { type?: string; issuer?: string; audience?: string | string[]; maxAgeSeconds?: Duration }): Promise<VerifyResult<T>>
}

export declare function createTokenSigner(options: { secret?: Secret; keyring?: Keyring; issuer?: string; audience?: string | string[]; clockToleranceSeconds?: number; maxTokenLength?: number }): TokenSigner
export declare function decodeTokenUnsafe(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null

export interface Sealer {
  seal(value: unknown, options?: { purpose?: string; expiresIn?: Duration }): Promise<string>
  unseal<T = unknown>(sealed: string, options?: { purpose?: string }): Promise<T | null>
}
export declare function createSealer(options: { secret?: Secret; keyring?: Keyring }): Sealer

export interface Keyring {
  size: number
  kid(index: number): Promise<string>
  hmac(purpose: string, index?: number, hash?: string): Promise<CryptoKey>
  aes(purpose: string, index?: number): Promise<CryptoKey>
  indexOfKid(kid: string): Promise<number>
}
export declare function createKeyring(secret: Secret): Keyring
export declare function normalizeSecrets(secret: Secret): string[]
export declare function toSeconds(value: Duration, name?: string): number
export declare const MIN_SECRET_LENGTH: number

export declare function randomToken(bytes?: number): string
export declare function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean
export declare function sha256Hex(input: string | Uint8Array): Promise<string>
export declare function base64urlEncode(input: string | Uint8Array): string
export declare function base64urlDecode(input: string): Uint8Array

// --- http --------------------------------------------------------------------

export interface CookieOptions {
  maxAge?: number
  expires?: Date | string | number
  path?: string
  domain?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  partitioned?: boolean
  priority?: 'Low' | 'Medium' | 'High'
}
export declare function parseCookieHeader(header: string | null | undefined): Record<string, string>
export declare function parseCookieHeaderAll(header: string | null | undefined): Record<string, string[]>
export declare function serializeCookie(name: string, value: string, options?: CookieOptions): string
export declare function expireCookie(name: string, options?: CookieOptions): string

export declare function applyCookies<T extends ResponseLike>(target: T, cookies: string | string[]): T
export declare function cookieHeaders(cookies: string[], init?: HeadersInit): Headers
export declare function getClientIp(request: RequestLike, options?: { trustProxy?: boolean }): string
export declare function getCookie(request: RequestLike, name: string): string | null
export declare function getHeader(request: RequestLike, name: string): string | null
export declare function isSecureRequest(request: RequestLike, options?: { trustProxy?: boolean }): boolean
export declare function isCrossSiteRequest(request: RequestLike, options?: { trustedOrigins?: string[]; trustProxy?: boolean; allowSafeMethods?: boolean }): boolean
export declare function safeRedirectPath(value: unknown, fallback?: string): string

// --- rate limits & passwords -------------------------------------------------

export interface CounterStore {
  get(key: string): Promise<unknown>
  increment(key: string, options?: { by?: number; ttlMs?: number }): Promise<number>
  delete?(key: string): Promise<unknown>
}
export interface LimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}
export interface RateLimiter {
  check(identifier: string, options?: { cost?: number }): Promise<LimitResult>
  peek(identifier: string): Promise<LimitResult>
  reset(identifier: string): Promise<void>
}
export declare function createRateLimiter(options: { name: string; max: number; window: Duration; store?: CounterStore }): RateLimiter
export interface LoginThrottle {
  check(attempt: { identifier: string; ip?: string }): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  fail(attempt: { identifier: string; ip?: string }): Promise<void>
  succeed(attempt: { identifier: string; ip?: string }): Promise<void>
}
export declare function createLoginThrottle(options?: {
  store?: CounterStore
  name?: string
  limits?: Partial<Record<'pair' | 'account' | 'ip', { max?: number; window?: Duration }>>
}): LoginThrottle
export declare function createMemoryCounterStore(options?: { maxKeys?: number }): CounterStore

export declare function checkPasswordStrength(
  password: unknown,
  options?: { minLength?: number; maxLength?: number; userInputs?: string[]; breached?: boolean; fetch?: typeof fetch },
): Promise<{ ok: boolean; errors: string[] }>
export declare function breachCount(password: string, options?: { fetch?: typeof fetch; timeoutMs?: number }): Promise<number>

// --- MFA ---------------------------------------------------------------------

type TotpOptions = { digits?: number; period?: number; algorithm?: 'SHA1' | 'SHA256' | 'SHA512' }
export declare function generateTotpSecret(bytes?: number): string
export declare function generateTotp(secret: string, options?: TotpOptions & { time?: number }): Promise<string>
export declare function verifyTotp(
  code: string,
  secret: string,
  options?: TotpOptions & { time?: number; window?: number; lastUsedStep?: number | null },
): Promise<{ valid: boolean; step: number | null; replay?: boolean }>
export declare function totpUri(options: { secret: string; issuer: string; account: string } & TotpOptions): string
export declare function generateRecoveryCodes(count?: number): Promise<{ codes: string[]; hashes: string[] }>
export declare function verifyRecoveryCode(code: string, hashes: string[]): Promise<number>
export declare function base32Encode(bytes: Uint8Array): string
export declare function base32Decode(input: string): Uint8Array

// --- OAuth -------------------------------------------------------------------

export interface OAuthProfile {
  provider: string
  id: string
  email: string | null
  /** Only true when the provider vouches for the address. Link accounts by email only when this is true. */
  emailVerified: boolean
  name: string | null
  avatarUrl: string | null
  [key: string]: unknown
}
export interface OAuthProvider {
  id: string
  authorizationUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  scopes: string[]
  authorizationParams?: Record<string, string>
  clientAuth?: 'post' | 'basic'
  oidc?: boolean
  profile(context: { get(url: string): Promise<any>; tokens: Record<string, any> }): Promise<Omit<OAuthProfile, 'provider'>>
}
type ProviderOptions = { clientId: string; clientSecret: string; redirectUri: string; scopes?: string[]; authorizationParams?: Record<string, string> }
export declare function oauthProvider(definition: Partial<OAuthProvider> & Pick<OAuthProvider, 'id' | 'authorizationUrl' | 'tokenUrl' | 'clientId' | 'redirectUri' | 'profile'>): OAuthProvider
export declare function github(options: ProviderOptions): OAuthProvider
export declare function google(options: ProviderOptions): OAuthProvider
export declare function discord(options: ProviderOptions): OAuthProvider
export declare function gitlab(options: ProviderOptions & { baseUrl?: string }): OAuthProvider
export declare function microsoft(options: ProviderOptions & { tenant?: string }): OAuthProvider

export declare class OAuthError extends Error {
  code: 'provider_error' | 'missing_params' | 'state_mismatch' | 'token_exchange_failed' | 'profile_failed'
  cookies?: string[]
}
export interface OAuth {
  start(provider: OAuthProvider, request: RequestLike | null, options?: { returnTo?: string; scopes?: string[]; params?: Record<string, string> }): Promise<{ url: string; cookies: string[] }>
  callback(provider: OAuthProvider, request: RequestLike): Promise<{ profile: OAuthProfile; tokens: Record<string, any>; returnTo: string; cookies: string[] }>
}
export declare function createOAuth(options: { sealer: Sealer; trustProxy?: boolean; cookieName?: string; fetch?: typeof fetch }): OAuth

// --- routes ------------------------------------------------------------------

export interface RouteOptions {
  /** Default "/api/auth". */
  basePath?: string
  /** Adds `user` to GET /session. */
  user?: (userId: UserId, session: CurrentSession) => unknown
}
export interface RouteResult {
  status: number
  body: unknown
  cookies: string[]
}
export declare function handleAuthRoute(auth: Auth, request: RequestLike, options?: RouteOptions): Promise<RouteResult | null>
export declare function createAuthHandler(auth: Auth, options?: RouteOptions): (request: Request) => Promise<Response>
export declare function jsonWithCookies(body: unknown, options?: { status?: number; cookies?: string[]; headers?: HeadersInit }): Response
export declare function redirectWithCookies(location: string, options?: { status?: number; cookies?: string[] }): Response
export declare function withSession<C extends object = {}>(
  auth: Auth,
  handler: (request: Request, context: C & { session: CurrentSession | null }) => Response | Promise<Response>,
  options?: { optional?: boolean; checkRevocation?: boolean },
): (request: Request, context?: C) => Promise<Response>
export type ProtectRule = string[] | RegExp | ((pathname: string) => boolean)
export declare function guardRequest(
  auth: Auth,
  request: Request,
  options?: { protect?: ProtectRule; guestOnly?: ProtectRule; loginPath?: string; homePath?: string },
): Promise<Response | null>
