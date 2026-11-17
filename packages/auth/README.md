<p align="center">
  <img src="https://raw.githubusercontent.com/Mbiyrukzz/tylix/main/packages/auth/logo.png" alt="Tylix Auth" width="160">
</p>

# @tylix/auth

Authentication for **any JavaScript framework**: Next.js, Nuxt, SvelteKit,
Remix, Astro, Hono, Express, Fastify, Koa and Tylix. It runs on Node, Bun,
Deno, Cloudflare Workers and the edge, and has no runtime dependencies.

```sh
npm install @tylix/auth
```

- **Sessions you can revoke.** Short-lived JWT access tokens and rotating
  refresh tokens, stored server-side as HMACs, with idle and absolute
  timeouts and a device list. Logout, "sign out everywhere" and password
  resets take effect immediately.
- **Token theft detection.** Every refresh rotates the refresh token. If an
  old one is replayed (someone holds a copy), the whole session ends. A
  short grace period keeps parallel tabs from tripping it.
- **CSRF protection without tokens.** Cookie-authenticated writes from
  other sites are refused using `Sec-Fetch-Site` and `Origin`, on top of
  `SameSite=Lax`. Sibling subdomains are not trusted unless you list them.
- **Hardened cookies.** `HttpOnly`, `__Host-`/`__Secure-` prefixes on HTTPS,
  and a refresh cookie scoped to the auth routes.
- **Strict JWTs.** The algorithm is pinned, each purpose (access,
  email verification, ...) gets its own HKDF-derived key, expiry is
  mandatory, base64url decoding is canonical, and secrets rotate through
  key ids.
- **Passwords.** scrypt (OWASP parameters), automatic rehash upgrades,
  Unicode normalization, a size cap against DoS, constant-time dummy work
  for unknown accounts (no timing-based user enumeration), and a NIST-style
  policy with an optional Have I Been Pwned check (k-anonymity).
- **Brute-force protection** that can't be used to lock someone else out:
  limits per account+IP, per account and per IP, over any shared store.
- **Two-factor authentication.** TOTP (RFC 6238) with replay protection, and
  hashed one-time recovery codes.
- **OAuth / social login.** PKCE on every flow, encrypted state cookies, and
  presets for GitHub, Google, Discord, GitLab and Microsoft. Emails count as
  verified only when the provider vouches for them.
- **AES-GCM sealing** for secrets you store (TOTP keys) or hand to the browser.

## Quick start

```js
// auth.js
import { createAuth, sqlAdapter } from '@tylix/auth/web'

export const auth = createAuth({
  secret: process.env.AUTH_SECRET, // 32+ random chars: openssl rand -base64 48
  adapter: sqlAdapter({ dialect: 'postgres', query: (sql, params) => pool.query(sql, params) }),
})
```

Logging in is yours: check the password your way, then start a session.

```js
import { verifyPassword } from '@tylix/auth/password'

const user = await db.users.findByEmail(email)
// Pass null for unknown users: the same work is done, so timing reveals nothing.
if (!(await verifyPassword(password, user?.passwordHash ?? null))) return unauthorized()
const { cookies } = await auth.signIn(request, user.id) // send these Set-Cookie headers
```

The session endpoints come built in. Mount them at `/api/auth/*`:

| Route | |
| --- | --- |
| `POST /api/auth/refresh` | rotate the refresh token, issue a new access token |
| `POST /api/auth/logout` | end this session |
| `POST /api/auth/logout-all` | end every session of this user |
| `GET /api/auth/session` | who is signed in (401 for guests) |
| `GET /api/auth/sessions` | this user's devices |
| `DELETE /api/auth/sessions/:id` | end one of them |

## Frameworks

### Next.js (App Router, Node or Edge)

```js
// app/api/auth/[...auth]/route.js
import { nextAuthHandlers } from '@tylix/auth/next'
export const { GET, POST, DELETE } = nextAuthHandlers(auth)

// middleware.js: stateless check, runs on the edge
import { nextMiddleware } from '@tylix/auth/next'
export default nextMiddleware(auth, { protect: ['/dashboard'], loginPath: '/login' })

// app/api/login/route.js
import { jsonWithCookies } from '@tylix/auth/next'
export async function POST(request) {
  const { email, password } = await request.json()
  // ...verify the password...
  const { cookies } = await auth.signIn(request, user.id)
  return jsonWithCookies({ ok: true }, { cookies })
}

// Server Components / Server Actions
import { headers } from 'next/headers'
const session = await auth.getSession(await headers())
```

### Nuxt / Nitro / h3

```js
// server/api/auth/[...].ts
import { h3AuthHandler } from '@tylix/auth/nuxt'
export default defineEventHandler(h3AuthHandler(auth))

// server/middleware/auth.ts: sets event.context.auth
import { h3AuthMiddleware } from '@tylix/auth/nuxt'
export default defineEventHandler(h3AuthMiddleware(auth, { protect: ['/dashboard'] }))

// a protected handler
import { requireH3Session } from '@tylix/auth/nuxt'
export default defineEventHandler(async (event) => {
  const { userId } = await requireH3Session(auth, event)
})

// login: const { cookies } = await auth.signIn(event, user.id); applyCookies(event, cookies)
```

### SvelteKit

```js
// src/hooks.server.js
import { sveltekitHandle } from '@tylix/auth/sveltekit'
export const handle = sveltekitHandle(auth, { protect: ['/account'] })

// +page.server.js action
await event.locals.signIn(user.id) // cookies are added to the response for you
event.locals.auth // the session, or null
```

### Hono (Node, Bun, Deno, Workers)

```js
import { honoAuth, honoAuthRoutes, honoRequireAuth } from '@tylix/auth/hono'
app.use('*', honoAuth(auth))
app.all('/api/auth/*', honoAuthRoutes(auth))
app.get('/api/me', honoRequireAuth(auth), (c) => c.json({ id: c.get('auth').userId }))
```

### Express, Fastify, Koa

```js
import { expressAuth, requireExpressAuth, applyCookies } from '@tylix/auth/express'
app.use(expressAuth(auth)) // req.auth, and serves /api/auth/*
app.get('/api/me', requireExpressAuth(), (req, res) => res.json({ id: req.auth.userId }))

import { fastifyAuth } from '@tylix/auth/fastify'
fastifyAuth(app, auth) // request.auth

import { koaAuth } from '@tylix/auth/koa'
app.use(koaAuth(auth)) // ctx.state.auth
```

### Remix, React Router, Astro, SolidStart, Bun, Deno, Workers

These frameworks all speak Web `Request`/`Response`:

```js
import { createAuthHandler } from '@tylix/auth/web'
const handler = createAuthHandler(auth) // (Request) => Response for /api/auth/*
const session = await auth.getSession(request)
```

### The browser

```js
import { createAuthClient } from '@tylix/auth/client'
const client = createAuthClient({ onSignOut: () => location.assign('/login') })
await client.fetch('/api/projects') // concurrent 401s share one refresh, then replay
await client.signOut({ everywhere: true }) // every open tab hears about it
```

Tokens stay in `HttpOnly` cookies, so page JavaScript (and XSS) never sees them.

## Session storage

| Adapter | For |
| --- | --- |
| `sqlAdapter({ dialect, query })` | `pg`, `mysql2`, `better-sqlite3`, `node:sqlite`, Drizzle/Kysely raw SQL. `createTableSql()` gives the schema. Rotation uses a real compare-and-swap. |
| `prismaAdapter(prisma.authSession)` | Prisma. The model definition is in `src/session/adapters/prisma.js`. |
| `keyValueAdapter(store)` | Redis, Upstash, Vercel KV, Cloudflare KV, Deno KV: anything with `get`, `set(key, value, { ttlMs })` and `delete`. |
| `modelAdapter(Model)` | Tylix ORM models (`tylix make:auth` sets this up). |
| `memoryAdapter()` | Tests and single-process development only. |

For a custom store, implement the six-method `SessionAdapter` interface in `web.d.ts`.

## Options

```js
createAuth({
  secret: [process.env.AUTH_SECRET, process.env.AUTH_SECRET_OLD], // rotation: first signs, all verify
  accessTokenTtl: '15m',
  sessionTtl: '30d',        // "remember me" sessions
  shortSessionTtl: '1d',    // signIn(req, id, { persistent: false }): browser-session cookies
  idleTimeout: '14d',
  rotationGrace: '30s',
  trustProxy: false,        // believe X-Forwarded-* only behind your own proxy
  trustedOrigins: [],       // other origins allowed to write with cookies
  cookies: { refreshPath: '/api/auth', sameSite: 'lax', domain: undefined },
  claims: (session) => ({ role: 'admin' }),           // extra access-token claims
  validateSession: async (session) => !isBanned(session.userId),
  onEvent: (event) => audit.log(event),               // session.created / refreshed / revoked / reuse_detected / ...
})
```

`auth.getSession(request)` checks revocation by default (one lookup by
primary key). In edge middleware that can't reach the database, pass
`{ checkRevocation: false }`. The access token's short lifetime then bounds
how long a revoked session can still pass.

## Two-factor authentication

```js
import { generateTotpSecret, totpUri, verifyTotp, generateRecoveryCodes, verifyRecoveryCode } from '@tylix/auth'

const secret = generateTotpSecret()
const uri = totpUri({ secret, issuer: 'Acme', account: user.email }) // render as a QR code
await db.users.update(user.id, { totp: await auth.sealer.seal(secret, { purpose: 'totp' }) })

const { valid, step } = await verifyTotp(code, await auth.sealer.unseal(user.totp, { purpose: 'totp' }), { lastUsedStep: user.totpStep })
if (valid) await db.users.update(user.id, { totpStep: step }) // the same code can't be replayed

const { codes, hashes } = await generateRecoveryCodes() // show codes once, store hashes
```

## OAuth

```js
import { createOAuth, github } from '@tylix/auth'
const oauth = createOAuth({ sealer: auth.sealer })
const provider = github({ clientId, clientSecret, redirectUri: 'https://app.example/auth/github/callback' })

// GET /auth/github
const { url, cookies } = await oauth.start(provider, request, { returnTo: '/dashboard' })
// redirect to url, sending cookies

// GET /auth/github/callback
const { profile, returnTo, cookies: clear } = await oauth.callback(provider, request)
// profile: { provider, id, email, emailVerified, name, avatarUrl }
// Link to an existing account by email ONLY if profile.emailVerified.
```

In a Tylix app this is already wired up: `make:auth` (and `create-tylix`
with authentication) generates `oauthStart` / `oauthCallback` on
`AuthController`, an `OAuthAccount` model, and "Continue with Google /
GitHub" buttons on the login and register pages. Set
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET` in `.env`, and register
`<APP_URL>/api/auth/oauth/<provider>/callback` with each provider. Other
providers are one row in the controller's `OAUTH_PROVIDERS` table.

## Other building blocks

- `createTokenSigner({ secret })` signs and verifies typed tokens such as
  email-verification or magic links:
  `sign(claims, { type: 'magic-link', expiresIn: '15m' })`.
- `createSealer({ secret })` gives you `seal()` and `unseal()` for
  encrypted, purpose-bound values that can expire.
- `createRateLimiter` and `createLoginThrottle` work over any counter store.
- `checkPasswordStrength(password, { userInputs, breached })` checks a
  new password.
- `isCrossSiteRequest(request)` and `safeRedirectPath(next)` are
  standalone CSRF and redirect checks.

## In Tylix apps

`tylix make:auth` scaffolds all of this into the app. It writes an
`AuthSession` model and migration, and an `AuthController` built on
`createAuth` with these routes: register, login, refresh, logout,
logout-all, sessions, change-password, verify-email, resend-verification,
forgot-password and reset-password. `requireAuth` (every `.auth()` route)
rejects tokens whose session has ended.

### Upgrading from 1.4

Run `tylix make:auth` and then `tylix migrate`. This regenerates the
controller and models and adds the `auth_sessions` table.

- **Everyone signs in once more.** Refresh tokens from the old
  `refresh_tokens` table aren't migrated.
- **`AUTH_SECRET` must be at least 32 characters in production.** Shorter
  secrets now stop the server from starting.
- **Old email-verification links stop working.** They were also usable as
  login tokens. Users can request a new link from
  `POST /api/auth/resend-verification`.
- **Access tokens default to 15 minutes, capped at an hour.** The
  rotating refresh session keeps people signed in.
- Controllers generated before 1.5 keep working without regenerating.
  They get the stricter `requireAuth` straight away. They also get the
  fixed refresh-cookie path from each user's next login, after which
  logout really revokes the session.
