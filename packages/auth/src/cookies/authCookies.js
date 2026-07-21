/**
 * httpOnly cookie helpers for access/refresh tokens.
 *
 * ASSUMPTION: your Express app has `cookie-parser` (or equivalent)
 * registered so `req.cookies` is populated, e.g.:
 *
 *   import cookieParser from "cookie-parser";
 *   app.use(cookieParser());
 */

const ACCESS_TOKEN_COOKIE = 'tylix_access_token'
const REFRESH_TOKEN_COOKIE = 'tylix_refresh_token'

const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export function setAuthCookies(
  res,
  { accessToken, refreshToken, accessTtlSeconds, refreshTtlSeconds } = {},
) {
  if (accessToken) {
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...baseCookieOptions,
      maxAge: accessTtlSeconds * 1000,
    })
  }

  if (refreshToken) {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...baseCookieOptions,
      maxAge: refreshTtlSeconds * 1000,
      // Scoped so the browser only sends it to the refresh endpoint.
      path: '/api/auth/refresh',
    })
  }
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookieOptions })
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...baseCookieOptions,
    path: '/api/auth/refresh',
  })
}

export function readAccessToken(req) {
  return req.cookies?.[ACCESS_TOKEN_COOKIE] ?? null
}

export function readRefreshToken(req) {
  return req.cookies?.[REFRESH_TOKEN_COOKIE] ?? null
}

export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE }
