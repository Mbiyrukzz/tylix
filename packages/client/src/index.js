import { createApi, resultFromResponse } from './createApi.js'
import { createAuth } from './createAuth.js'
export { channel, lazyChannel } from './channel.js'

export { createApi, createAuth, resultFromResponse }

// Builds a matching api + auth pair: when the api can't refresh an expired
// session, the auth store switches to guest.
export function createClient(options = {}) {
  let auth = null
  const api = createApi({
    ...options,
    onSessionExpired: () => auth?.expire(),
  })
  auth = createAuth({ api, channel: options.channel })
  return { api, auth }
}

// The shared instance apps import. Created lazily so merely importing this
// module (during SSR or in tests) opens no BroadcastChannel.
let defaultClient = null
function getDefault() {
  if (!defaultClient) defaultClient = createClient()
  return defaultClient
}

export function api(url, options) {
  return getDefault().api(url, options)
}
api.get = (url, options) => getDefault().api.get(url, options)
api.post = (url, body, options) => getDefault().api.post(url, body, options)
api.put = (url, body, options) => getDefault().api.put(url, body, options)
api.patch = (url, body, options) => getDefault().api.patch(url, body, options)
api.delete = (url, options) => getDefault().api.delete(url, options)

// For HTTP layers other than api(), e.g. Angular's HttpClient interceptor:
// the same single shared refresh that api() uses, and the same "session
// over" handling when it fails. Resolves true if the session was renewed.
export async function refreshSession() {
  const client = getDefault()
  const renewed = await client.api.refreshSession()
  if (!renewed) client.auth.expire()
  return renewed
}

export const auth = {
  getState: () => getDefault().auth.getState(),
  subscribe: (listener) => getDefault().auth.subscribe(listener),
  init: () => getDefault().auth.init(),
  reload: () => getDefault().auth.reload(),
  login: (email, password) => getDefault().auth.login(email, password),
  register: (details) => getDefault().auth.register(details),
  logout: () => getDefault().auth.logout(),
  forgotPassword: (email) => getDefault().auth.forgotPassword(email),
  resetPassword: (details) => getDefault().auth.resetPassword(details),
}
