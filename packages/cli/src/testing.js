// Testing helpers for Tylix apps: call the app's own API in-process, as a
// guest or as any user, through the same middleware and auth as a real
// request. No server, no port, no login round trip.
//
//   import { createTestClient } from '@tylix/cli/testing'
//   const client = await createTestClient()
//   const res = await client.get('/api/posts', { as: user })
//   await client.close()
import { signToken } from '@tylix/auth'
import { ConnectionManager } from '@tylix/orm'
import { createApp } from './server/createApp.js'
import { createInProcessRequest } from './frontend/session.js'

// request(method, url, { body, as, headers }) for a built app.
// `as` is a user id or an object with an id: the request carries a
// short-lived access token for that user, signed with the app's secret,
// exactly what logging in would give them.
export function createRequester(app) {
  const inProcess = createInProcessRequest(app.router)
  return async function request(method, url, { body = null, as = null, headers = {} } = {}) {
    if (typeof url !== 'string' || !url.startsWith('/')) {
      throw new Error(`Pass a path such as "/api/posts", not ${JSON.stringify(url)}.`)
    }
    const finalHeaders = { ...headers }
    if (as != null) {
      const userId = typeof as === 'object' ? as.id : as
      if (userId == null) throw new Error('`as` needs a user id or a user with an id.')
      const token = signToken({ userId }, app.config.auth.secret, { expiresInSeconds: 300 })
      finalHeaders.authorization = `Bearer ${token}`
    }
    const { status, data } = await inProcess({ method, url, body, headers: finalHeaders })
    return { status, data }
  }
}

// Builds the app's API (no frontend) in `baseDir` and connects its
// database. Call close() when done so the test process can exit.
export async function createTestClient({ baseDir = process.cwd() } = {}) {
  const app = await createApp(baseDir, { frontend: false })
  const request = createRequester(app)
  return {
    app,
    request,
    get: (url, options) => request('GET', url, options),
    post: (url, body, options) => request('POST', url, { ...options, body }),
    put: (url, body, options) => request('PUT', url, { ...options, body }),
    patch: (url, body, options) => request('PATCH', url, { ...options, body }),
    delete: (url, options) => request('DELETE', url, options),
    async close() {
      await ConnectionManager.getAdapter()?.close?.()
    },
  }
}
