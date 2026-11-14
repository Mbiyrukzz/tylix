import { base64urlEncode, randomToken, sha256, timingSafeEqual } from '../core/crypto.js'
import { serializeCookie, expireCookie } from '../http/cookies.js'
import { getCookie, getSearchParam, isSecureRequest } from '../http/request.js'
import { safeRedirectPath } from '../http/origin.js'
import { isProduction } from '../core/keys.js'

// "Sign in with GitHub / Google / ..." (OAuth 2.0 authorization code flow)
// done safely:
//   - PKCE (S256) on every flow, even for confidential clients
//   - a random `state`, kept in an encrypted, short-lived, httpOnly cookie
//     and compared in constant time on the way back (stops login CSRF)
//   - a random `nonce` for OpenID providers
//   - the profile comes from the provider's API over TLS, server to server
//   - an email is only marked verified when the provider says so: link
//     accounts by email ONLY when profile.emailVerified is true
//   - returnTo is restricted to same-site paths (no open redirects)

export class OAuthError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

const STATE_COOKIE = 'auth.oauth'

export function createOAuth({ sealer, trustProxy = false, cookieName = STATE_COOKIE, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!sealer) throw new TypeError('createOAuth needs a sealer (use auth.oauth, or createSealer({ secret })).')

  const cookieFor = (request) => {
    const secure = isProduction() || (request ? isSecureRequest(request, { trustProxy }) : false)
    return { name: secure ? `__Host-${cookieName}` : cookieName, secure }
  }

  /** Begins a flow. Redirect to `url` and send `cookies` with that redirect. */
  async function start(provider, request, { returnTo = '/', scopes, params = {} } = {}) {
    const state = randomToken(32)
    const verifier = randomToken(48)
    const nonce = provider.oidc ? randomToken(24) : null
    const challenge = base64urlEncode(await sha256(verifier))

    const url = new URL(provider.authorizationUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', provider.clientId)
    url.searchParams.set('redirect_uri', provider.redirectUri)
    url.searchParams.set('scope', (scopes ?? provider.scopes).join(' '))
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (nonce) url.searchParams.set('nonce', nonce)
    for (const [k, v] of Object.entries({ ...provider.authorizationParams, ...params })) url.searchParams.set(k, v)

    const { name, secure } = cookieFor(request)
    const sealed = await sealer.seal(
      { p: provider.id, s: state, v: verifier, n: nonce, r: safeRedirectPath(returnTo) },
      { purpose: 'oauth-state', expiresIn: 600 },
    )
    const cookie = serializeCookie(name, sealed, { secure, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 })
    return { url: url.toString(), cookies: [cookie] }
  }

  /**
   * Finishes a flow on the redirect_uri route. Resolves
   * { profile, tokens, returnTo, cookies } or throws OAuthError.
   */
  async function callback(provider, request) {
    const { name, secure } = cookieFor(request)
    const clear = [expireCookie(name, { secure, httpOnly: true, sameSite: 'lax', path: '/' })]
    const fail = (code, message) => {
      const error = new OAuthError(code, message)
      error.cookies = clear
      throw error
    }

    const providerError = getSearchParam(request, 'error')
    if (providerError) fail('provider_error', `The provider refused the sign-in (${providerError}).`)

    const code = getSearchParam(request, 'code')
    const state = getSearchParam(request, 'state')
    if (!code || !state) fail('missing_params', 'The sign-in response is incomplete.')

    const stored = await sealer.unseal(getCookie(request, name), { purpose: 'oauth-state' })
    if (!stored || stored.p !== provider.id || !timingSafeEqual(stored.s, state)) {
      fail('state_mismatch', 'This sign-in link is invalid or has expired. Please try again.')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: provider.redirectUri,
      code_verifier: stored.v,
      client_id: provider.clientId,
    })
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
    if (provider.clientAuth === 'basic') {
      headers.Authorization = `Basic ${btoa(`${encodeURIComponent(provider.clientId)}:${encodeURIComponent(provider.clientSecret)}`)}`
    } else if (provider.clientSecret) {
      body.set('client_secret', provider.clientSecret)
    }

    let tokens
    try {
      const response = await fetchImpl(provider.tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
      tokens = await response.json()
      if (!response.ok || tokens.error || !tokens.access_token) {
        fail('token_exchange_failed', `The provider did not issue a token${tokens?.error ? ` (${tokens.error})` : ''}.`)
      }
    } catch (error) {
      if (error instanceof OAuthError) throw error
      fail('token_exchange_failed', 'Could not reach the sign-in provider.')
    }
    if (tokens.token_type && String(tokens.token_type).toLowerCase() !== 'bearer') fail('token_exchange_failed', 'Unexpected token type.')

    const get = async (url) => {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json', 'User-Agent': '@tylix/auth' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) fail('profile_failed', 'Could not load your profile from the provider.')
      return response.json()
    }

    let profile
    try {
      profile = await provider.profile({ get, tokens })
    } catch (error) {
      if (error instanceof OAuthError) throw error
      fail('profile_failed', 'Could not load your profile from the provider.')
    }
    if (!profile?.id) fail('profile_failed', 'The provider returned no account id.')

    return {
      profile: { provider: provider.id, ...profile, id: String(profile.id), emailVerified: profile.emailVerified === true },
      tokens,
      returnTo: safeRedirectPath(stored.r),
      cookies: clear,
    }
  }

  return { start, callback }
}
