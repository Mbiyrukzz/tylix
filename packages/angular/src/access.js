// Framework-free rules shared by the guards and the app's session watcher,
// kept apart so they can be tested without Angular.

// Where to go after logging in: the ?next= path, if it stays on this site,
// else the dashboard. "//evil.com" or "https://evil.com" would leave it.
export function nextPath(next) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
    return next
  }
  return '/dashboard'
}

// What to do with a page of the given access level for a session status:
//   null             show it
//   { login: url }   send to /login?next=url
//   { to: path }     send somewhere else (a logged-in user on a guest page)
// access is 'auth' (logged-in only), 'guest' (logged-out only) or absent.
export function decideAccess(access, status, url, next) {
  if (access === 'auth' && status !== 'authenticated') return { login: url }
  if (access === 'guest' && status === 'authenticated') return { to: nextPath(next) }
  return null
}

const AUTH_PATHS = new Set(['/api/login', '/api/register', '/api/auth/refresh', '/api/auth/logout'])

// Whether a 401 from `url` means "access token expired, try a refresh".
// On the auth endpoints a 401 means wrong credentials or no session.
export function canRefreshAfter401(url) {
  let pathname
  try {
    pathname = new URL(url, 'http://tylix.local').pathname
  } catch {
    pathname = String(url).split('?')[0]
  }
  return !AUTH_PATHS.has(pathname)
}
