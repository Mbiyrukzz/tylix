// The request function every frontend uses to talk to the Tylix backend.
//
// It returns the same result shape as the native useApi:
//   { ok, status, data, error, errors }
// and never throws for HTTP or network failures, so UI code can branch on
// `result.ok` instead of wrapping every call in try/catch.
//
// Sessions live in httpOnly cookies that JavaScript can't read, so every
// request is sent with credentials. When a request comes back 401, the
// access token has probably expired: the client calls /api/auth/refresh
// once and replays the request. Concurrent 401s share that single refresh.

// Endpoints whose 401 means "wrong credentials" or "no session to refresh",
// never "access token expired". Refreshing on these would loop.
const AUTH_PATHS = new Set([
  '/api/login',
  '/api/register',
  '/api/auth/refresh',
  '/api/auth/logout',
])

const REFRESH_PATH = '/api/auth/refresh'

function pathnameOf(url) {
  try {
    return new URL(url, 'http://tylix.local').pathname
  } catch {
    return String(url).split('?')[0]
  }
}

function isNativeBody(body) {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' &&
      body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}

// A stream can only be read once, so a request with one can't be replayed
// after a refresh.
function isReplayable(body) {
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
}

function errorMessage(data, status) {
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string') return data.error
    if (typeof data.message === 'string') return data.message
    // 422 validation errors: { errors: { field: ["message"] } }
    if (data.errors && typeof data.errors === 'object') {
      const first = Object.values(data.errors)[0]
      if (Array.isArray(first) && first.length > 0) return String(first[0])
    }
  }
  return `Request failed (HTTP ${status})`
}

// The result every request resolves to, built from an HTTP status and the
// parsed JSON body. Exported so server-side rendering can turn in-process
// responses into exactly what api() returns in the browser.
export function resultFromResponse(status, data) {
  const ok = status >= 200 && status < 300
  if (ok) return { ok, status, data, error: null, errors: null }
  return {
    ok,
    status,
    data,
    error: errorMessage(data, status),
    errors: data && typeof data === 'object' && data.errors ? data.errors : null,
  }
}

function logDebug(debug, method, url) {
  // Only present when the server runs with APP_DEBUG=true.
  try {
    console.groupCollapsed(`[tylix] ${debug.status ?? ''} ${method} ${url}: ${debug.title || debug.message}`)
    if (debug.hint) console.log('How to fix:', debug.hint)
    if (debug.message) console.log('Message:', debug.message)
    if (debug.sql) console.log('SQL:', debug.sql)
    if (debug.source) console.log('Source:', `${debug.source.file}:${debug.source.line}`)
    console.groupEnd()
  } catch {
    // Logging must never break a request.
  }
}

export function createApi({
  baseUrl = '',
  fetch: fetchImpl,
  onSessionExpired = () => {},
} = {}) {
  let refreshing = null

  const getFetch = () => {
    const f = fetchImpl ?? globalThis.fetch
    if (typeof f !== 'function') {
      throw new Error('[tylix] fetch is not available in this environment.')
    }
    return f
  }

  async function send(url, options = {}) {
    const {
      method = 'GET',
      body,
      headers = {},
      credentials = 'include',
      timeout = 0,
      signal,
    } = options

    const upper = String(method).toUpperCase()
    const finalHeaders = { Accept: 'application/json', ...headers }
    const hasHeader = (name) =>
      Object.keys(finalHeaders).some((k) => k.toLowerCase() === name)

    let finalBody = body
    if (body !== undefined && body !== null && typeof body === 'object' && !isNativeBody(body)) {
      if (!hasHeader('content-type')) finalHeaders['Content-Type'] = 'application/json'
      finalBody = JSON.stringify(body)
    }
    if ((upper === 'GET' || upper === 'HEAD') && finalBody !== undefined) {
      console.warn(`[tylix] ${upper} ${url}: a ${upper} request cannot have a body, so it was ignored.`)
      finalBody = undefined
    }

    let controller = null
    let timer = null
    let fetchSignal = signal
    if (timeout > 0) {
      controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeout)
      if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', () => controller.abort(), { once: true })
      }
      fetchSignal = controller.signal
    }

    try {
      const response = await getFetch()(baseUrl + url, {
        method: upper,
        headers: finalHeaders,
        body: finalBody,
        credentials,
        signal: fetchSignal,
      })

      let data = null
      try {
        const text = await response.text()
        if (text) data = JSON.parse(text)
      } catch {
        // empty or non-JSON body
      }

      if (!response.ok) {
        const debug = data && typeof data === 'object' && data.debug ? data.debug : null
        if (debug) logDebug(debug, upper, url)
      }
      return resultFromResponse(response.status, data)
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, status: 0, data: null, error: 'Request was cancelled', errors: null, aborted: true }
      }
      const timedOut = controller?.signal.aborted
      const message = timedOut ? `Request timed out after ${timeout}ms` : err.message
      console.warn(`[tylix] ${upper} ${url} could not reach the server: ${message}`)
      return { ok: false, status: 0, data: null, error: message, errors: null }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // One refresh at a time: every request that hits a 401 while a refresh
  // is running waits for that same refresh instead of starting another.
  function refreshSession() {
    if (!refreshing) {
      refreshing = send(REFRESH_PATH, { method: 'POST' })
        .then((result) => result.ok)
        .finally(() => {
          refreshing = null
        })
    }
    return refreshing
  }

  async function api(url, options = {}) {
    const result = await send(url, options)

    const canRefresh =
      result.status === 401 &&
      options.refresh !== false &&
      !AUTH_PATHS.has(pathnameOf(url)) &&
      isReplayable(options.body)

    if (!canRefresh) return result

    if (await refreshSession()) {
      return send(url, options)
    }
    onSessionExpired()
    return result
  }

  api.get = (url, options) => api(url, { ...options, method: 'GET' })
  api.post = (url, body, options) => api(url, { ...options, method: 'POST', body })
  api.put = (url, body, options) => api(url, { ...options, method: 'PUT', body })
  api.patch = (url, body, options) => api(url, { ...options, method: 'PATCH', body })
  api.delete = (url, options) => api(url, { ...options, method: 'DELETE' })
  api.refreshSession = refreshSession

  return api
}
