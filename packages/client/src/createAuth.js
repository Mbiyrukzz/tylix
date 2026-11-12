// The auth session store shared by every frontend binding.
//
// State is always one of:
//   { status: 'loading',       user: null }   before the first check
//   { status: 'authenticated', user: {...} }
//   { status: 'guest',         user: null, expired? }
//
// The state object is replaced (never mutated) on every change, so
// framework bindings can compare snapshots by reference (React's
// useSyncExternalStore relies on this).
//
// Tokens are httpOnly cookies set by the server. This store never sees or
// stores them: it only knows who the server says is logged in.

const CHANNEL_NAME = 'tylix:auth'

export function createAuth({ api, channel } = {}) {
  if (typeof api !== 'function') {
    throw new Error('createAuth needs an api function.')
  }

  let state = { status: 'loading', user: null }
  const listeners = new Set()
  let initPromise = null

  // Logging out in one tab logs out the others; logging in makes them
  // re-check the session. Skipped where BroadcastChannel doesn't exist.
  const bus =
    channel !== undefined
      ? channel
      : typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(CHANNEL_NAME)
        : null

  function setState(next) {
    state = next
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch (err) {
        console.error('[tylix] auth listener failed:', err)
      }
    }
  }

  function authenticated(user) {
    setState({ status: 'authenticated', user })
  }

  function guest(extra = {}) {
    setState({ status: 'guest', user: null, ...extra })
  }

  function announce(type) {
    try {
      bus?.postMessage({ type })
    } catch {
      // A closed channel must not break login or logout.
    }
  }

  // In Node (SSR, tests) an open channel would keep the process alive.
  if (bus && channel === undefined) bus.unref?.()

  if (bus) {
    bus.onmessage = (event) => {
      const type = event?.data?.type
      if (type === 'logout') guest()
      else if (type === 'login') reload()
    }
  }

  async function fetchMe() {
    const result = await api('/api/me')
    if (result.ok && result.data) authenticated(result.data)
    else guest()
    return result
  }

  // Runs the first session check once, however many components ask.
  // The server may have put the session in the page (__TYLIX_SESSION__):
  //   { user: {...} }  logged in: used as-is, no /api/me round trip
  //   { user: null }   no valid access token: start as guest right away (so
  //                    server-rendered guest pages hydrate without a flash),
  //                    but still check in the background, because a valid
  //                    refresh token may bring the session back
  // The state is set synchronously, so calling init() before hydrating
  // makes the first client render match the server's.
  function init() {
    if (!initPromise) {
      const injected = globalThis.__TYLIX_SESSION__
      if (injected && injected.user) {
        authenticated(injected.user)
        initPromise = Promise.resolve()
      } else if (injected) {
        guest()
        initPromise = fetchMe().then(() => undefined)
      } else {
        initPromise = fetchMe().then(() => undefined)
      }
    }
    return initPromise
  }

  function reload() {
    initPromise = fetchMe().then(() => undefined)
    return initPromise
  }

  async function login(email, password) {
    const result = await api('/api/login', {
      method: 'POST',
      body: { email, password },
    })
    if (result.ok) {
      authenticated(result.data?.user ?? null)
      initPromise = Promise.resolve()
      announce('login')
    }
    return result
  }

  // Registering does not log in: the account must verify its email first.
  function register({ name, email, password }) {
    return api('/api/register', {
      method: 'POST',
      body: { name, email, password },
    })
  }

  async function logout() {
    const result = await api('/api/auth/logout', { method: 'POST' })
    // Cleared locally even if the request failed: the user asked to leave.
    guest()
    initPromise = Promise.resolve()
    announce('logout')
    return result
  }

  function forgotPassword(email) {
    return api('/api/auth/forgot-password', { method: 'POST', body: { email } })
  }

  // The reset link carries both the token and the email it was sent to;
  // the server checks them together.
  function resetPassword({ email, token, password }) {
    return api('/api/auth/reset-password', {
      method: 'POST',
      body: { email, token, password },
    })
  }

  // Called by the api client when a refresh fails. Only a user who was
  // logged in can have a session "expire"; a first visit with no session
  // (status still 'loading') is just a guest.
  function expire() {
    if (state.status === 'authenticated') guest({ expired: true })
  }

  // Bound functions (closures, not methods) so they can be passed around
  // or destructured without losing `this`.
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    init,
    reload,
    login,
    register,
    logout,
    forgotPassword,
    resetPassword,
    expire,
  }
}
