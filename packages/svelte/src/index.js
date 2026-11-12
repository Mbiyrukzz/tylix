// Svelte bindings for the Tylix client. Everything is a Svelte store, so
// components read it with $-syntax ($session.user, $posts.data). The
// session logic itself (refresh, cross-tab sync) lives in @tylix/client,
// so every frontend behaves the same.
//
// With SSR, a page is rendered on the server once per request. The shared
// `session` and `route` stores describe the browser, so components use the
// use*() functions below, which return the request's own state on the
// server and the shared stores in the browser.
import { getContext, onMount } from 'svelte'
import { api, auth } from '@tylix/client'
import { readable, writable } from './store.js'
import { route } from './router.js'

export { api, auth }
export { route, navigate, matchPath } from './router.js'

// Set as context only while a page renders on the server (see ./server.js):
// that request's session, location and loaded data, and what the render
// decided about the response (status, redirect).
export const serverContextKey = Symbol.for('tylix:server')

// The server render's context while rendering on the server; null in the
// browser. Call during component initialisation (top of <script>).
//   const server = useServerContext()
//   if (server) server.status = 404
export function useServerContext() {
  try {
    return getContext(serverContextKey) ?? null
  } catch {
    return null // not inside a component
  }
}

function toSession(state) {
  return {
    status: state.status,
    user: state.user,
    expired: Boolean(state.expired),
    loading: state.status === 'loading',
    isAuthenticated: state.status === 'authenticated',
  }
}

// The current session in the browser. The first subscriber starts the
// session check; later ones share it.
export const session = readable(toSession({ status: 'loading', user: null }), (set) => {
  const unsubscribe = auth.subscribe((state) => set(toSession(state)))
  set(toSession(auth.getState()))
  auth.init()
  return unsubscribe
})

// The session for this component: the request's on the server, the shared
// store in the browser. Use this rather than `session` in SSR apps.
export function useSession() {
  const server = useServerContext()
  return server ? readable(toSession(server.authState)) : session
}

// The current location for this component: the request's on the server,
// the shared router store in the browser.
export function useRoute() {
  const server = useServerContext()
  return server ? readable(server.route) : route
}

// False on the server and while a server-rendered page is hydrating; true
// once mounted. Before that, a form's submit button would do a native
// submit and reload the page, losing what was typed, so starter forms keep
// their buttons disabled until this is true:  disabled={!$hydrated}
export function useHydrated() {
  const hydrated = writable(false)
  if (typeof window !== 'undefined') {
    onMount(() => hydrated.set(true))
  }
  return { subscribe: hydrated.subscribe }
}

const IDLE = { ok: false, status: null, data: null, error: null, errors: null }

function isGet(options) {
  return !options?.method || String(options.method).toUpperCase() === 'GET'
}

// Data a server render loaded for `url`, embedded in the page.
function serverRenderedData(url) {
  const data = globalThis.__TYLIX_DATA__
  return url != null && data && Object.hasOwn(data, url) ? data[url] : undefined
}

// A store that fetches `url` while something subscribes to it, with a
// reload() to fetch again. Pass null to skip fetching. Leaving the page
// (the last unsubscribe) cancels a request still in flight.
//
//   const posts = useApi('/api/posts')
//   {#each $posts.data ?? [] as post} ... {/each}
//
// With SSR, GET requests are loaded on the server and the page arrives with
// their data; in the browser the first subscription reuses it.
export function useApi(url, options) {
  const server = useServerContext()
  if (server || typeof window === 'undefined') {
    // On the server nothing is fetched here: the renderer loads what was
    // asked for in-process and renders again (see ./server.js).
    let state = { ...IDLE, loading: url != null }
    if (server && url != null && isGet(options)) {
      if (server.cache.has(url)) state = { ...server.cache.get(url), loading: false }
      else server.pending.add(url)
    }
    return { subscribe: readable(state).subscribe, reload: async () => null }
  }

  let set = null
  let current = { ...IDLE, loading: url != null }
  let controller = null
  let runId = 0

  // Data from the server-rendered page replaces the first fetch, once.
  let skipFirstRun = false
  const preloaded = serverRenderedData(url)
  if (preloaded) {
    current = { ...preloaded, loading: false }
    skipFirstRun = true
    delete globalThis.__TYLIX_DATA__[url]
  }

  const update = (next) => {
    current = next
    set?.(next)
  }

  async function run() {
    if (url == null) {
      update({ ...IDLE, loading: false })
      return null
    }
    const id = ++runId
    controller?.abort()
    controller = new AbortController()
    update({ ...current, loading: true })
    const response = await api(url, { ...options, signal: controller.signal })
    if (id === runId && !response.aborted) update({ ...response, loading: false })
    return response
  }

  const store = readable(current, (setter) => {
    set = setter
    set(current)
    if (skipFirstRun) skipFirstRun = false
    else run()
    return () => {
      set = null
      runId++
      controller?.abort()
    }
  })

  return { subscribe: store.subscribe, reload: run }
}
