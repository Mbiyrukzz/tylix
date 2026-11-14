/**
 * httpOnly cookie helpers for access/refresh tokens, for AuthControllers
 * generated before 1.5 (current ones get their cookies from createAuth()).
 *
 * Works with any response that has res.cookie() (Express, Tylix) or
 * setHeader(); reads from req.cookies or the raw Cookie header.
 */

import { expireCookie, parseCookieHeaderAll, serializeCookie } from '../http/cookies.js'

const ACCESS_TOKEN_COOKIE = 'tylix_access_token'
const REFRESH_TOKEN_COOKIE = 'tylix_refresh_token'

// The refresh cookie used to be scoped to /api/auth/refresh only, so it
// never reached /api/auth/logout and logging out could not revoke it.
// It now covers /api/auth; the old path is expired whenever it's set.
export const REFRESH_TOKEN_PATH = '/api/auth'
const LEGACY_REFRESH_PATH = '/api/auth/refresh'

function secure(req) {
  return process.env.NODE_ENV === 'production' || req?.secure === true
}

function setCookie(res, value) {
  if (typeof res.setHeader !== 'function') return
  const existing = res.getHeader?.('Set-Cookie')
  const list = existing == null ? [] : Array.isArray(existing) ? existing : [String(existing)]
  res.setHeader('Set-Cookie', [...list, value])
}

function options(res, path) {
  return { httpOnly: true, sameSite: 'lax', secure: secure(res?.req), path }
}

export function setAuthCookies(
  res,
  { accessToken, refreshToken, accessTtlSeconds, refreshTtlSeconds } = {},
) {
  if (accessToken) {
    setCookie(res, serializeCookie(ACCESS_TOKEN_COOKIE, accessToken, { ...options(res, '/'), maxAge: accessTtlSeconds }))
  }

  if (refreshToken) {
    setCookie(res, serializeCookie(REFRESH_TOKEN_COOKIE, refreshToken, { ...options(res, REFRESH_TOKEN_PATH), maxAge: refreshTtlSeconds }))
    setCookie(res, expireCookie(REFRESH_TOKEN_COOKIE, options(res, LEGACY_REFRESH_PATH)))
  }
}

export function clearAuthCookies(res) {
  setCookie(res, expireCookie(ACCESS_TOKEN_COOKIE, options(res, '/')))
  setCookie(res, expireCookie(REFRESH_TOKEN_COOKIE, options(res, REFRESH_TOKEN_PATH)))
  setCookie(res, expireCookie(REFRESH_TOKEN_COOKIE, options(res, LEGACY_REFRESH_PATH)))
}

function readAll(req, name) {
  const fromHeader = parseCookieHeaderAll(req?.headers?.cookie)[name]
  if (fromHeader?.length) return fromHeader
  const value = req?.cookies?.[name]
  return value ? [value] : []
}

export function readAccessToken(req) {
  return readAll(req, ACCESS_TOKEN_COOKIE)[0] ?? null
}

// With both an old-path and a new-path cookie present, the browser sends
// the more specific (old) one first; the newest is the last one.
export function readRefreshToken(req) {
  const all = readAll(req, REFRESH_TOKEN_COOKIE)
  return all[all.length - 1] ?? null
}

export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE }
