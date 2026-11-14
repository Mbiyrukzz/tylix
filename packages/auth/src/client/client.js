// Browser client for any frontend (React, Vue, Svelte, Solid, Angular,
// vanilla). Tokens stay in httpOnly cookies, out of reach of page
// JavaScript (and so of XSS); this only handles the refresh dance:
//
//   const client = createAuthClient()
//   const res = await client.fetch('/api/projects')   // refreshes once on 401, then replays
//   await client.signOut()
//
// Concurrent 401s share one refresh. Tabs hear about sign-outs from each
// other through BroadcastChannel, so `onSignOut` fires everywhere.

export function createAuthClient({ baseUrl = '', basePath = '/api/auth', fetch: fetchImpl = globalThis.fetch?.bind(globalThis), onSignOut } = {}) {
  let refreshing = null
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tylix-auth') : null
  // Server-side (SSR, tests) the channel must not keep the process alive.
  channel?.unref?.()
  const listeners = new Set(onSignOut ? [onSignOut] : [])
  channel?.addEventListener('message', (event) => {
    if (event.data === 'signed-out') for (const fn of listeners) fn()
  })

  const url = (path) => `${baseUrl}${basePath}${path}`
  const authPaths = new Set(['/refresh', '/logout', '/logout-all'].map((p) => `${basePath}${p}`))

  function refresh() {
    refreshing ??= fetchImpl(url('/refresh'), { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  async function authFetch(input, init = {}) {
    const request = { credentials: 'include', ...init }
    const response = await fetchImpl(input, request)
    const path = (() => {
      try {
        return new URL(typeof input === 'string' ? input : input.url, globalThis.location?.href ?? 'http://localhost').pathname
      } catch {
        return ''
      }
    })()
    if (response.status !== 401 || authPaths.has(path)) return response
    // A body stream can't be sent twice.
    if (typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream) return response
    if (!(await refresh())) {
      for (const fn of listeners) fn()
      return response
    }
    return fetchImpl(input, request)
  }

  return {
    fetch: authFetch,
    refresh,
    async session() {
      const response = await authFetch(url('/session'))
      return response.ok ? response.json() : null
    },
    async sessions() {
      const response = await authFetch(url('/sessions'))
      return response.ok ? (await response.json()).sessions : []
    },
    async revokeSession(id) {
      return (await authFetch(url(`/sessions/${encodeURIComponent(id)}`), { method: 'DELETE' })).ok
    },
    async signOut({ everywhere = false } = {}) {
      await fetchImpl(url(everywhere ? '/logout-all' : '/logout'), { method: 'POST', credentials: 'include' }).catch(() => {})
      channel?.postMessage('signed-out')
      for (const fn of listeners) fn()
    },
    onSignOut(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    close() {
      channel?.close()
      listeners.clear()
    },
  }
}
