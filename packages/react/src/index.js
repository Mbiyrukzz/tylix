// React bindings for the Tylix client. They hold no logic of their own:
// sessions, refresh and cross-tab sync all live in @tylix/client, so every
// frontend behaves the same.
//
// Written with createElement instead of JSX so the package ships as plain
// JavaScript and needs no build step.
import {
  createContext,
  createElement,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { api, auth, lazyChannel } from '@tylix/client'

export { api, auth }

// Present only while a page renders on the server (see ./server.js). It
// carries that request's session, the API data loaded so far, and what the
// render decided about the response (status, redirect).
export const ServerContext = createContext(null)

// For components that affect the server response during SSR:
//   const server = useServerContext()
//   if (server) server.status = 404
// Always null in the browser.
export function useServerContext() {
  return useContext(ServerContext)
}

// A live channel on the channel server ("tylix channels:work"):
//   const { send, status } = useChannel('chat', (message) => ...)
// Connects once mounted (never during server rendering), reconnects on its
// own, and closes when the component unmounts. send() before the
// connection opens is queued.
export function useChannel(name, onMessage) {
  const handler = useRef(onMessage)
  handler.current = onMessage
  const [status, setStatus] = useState('connecting')
  const live = useRef(null)
  if (live.current === null || live.current.name !== name) {
    live.current = { name, channel: lazyChannel(name, { onMessage: (data) => handler.current?.(data), onStatus: setStatus }) }
  }
  useEffect(() => {
    const current = live.current.channel
    current.open()
    return () => current.close()
  }, [name])
  const send = useCallback((data) => live.current.channel.send(data), [])
  return { send, status }
}

const subscribeNever = () => () => {}

// False on the server and while a server-rendered page is hydrating; true
// once React has taken over the page. Before that, a form's submit button
// would do a native submit and reload the page, losing what was typed, so
// starter forms keep their buttons disabled until this is true:
//   <button disabled={submitting || !hydrated}>
export function useHydrated() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
}

// The current session plus the actions that change it. The first component
// that calls this starts the session check; later ones share it.
export function useAuth() {
  const server = useContext(ServerContext)
  // On the server, the session comes from this request. In the browser,
  // hydration reads the client state, which main.jsx initialised from the
  // session the server put in the page, so both renders agree.
  const state = useSyncExternalStore(
    auth.subscribe,
    auth.getState,
    server ? () => server.authState : auth.getState,
  )

  useEffect(() => {
    auth.init()
  }, [])

  return {
    status: state.status,
    user: state.user,
    expired: Boolean(state.expired),
    loading: state.status === 'loading',
    isAuthenticated: state.status === 'authenticated',
    login: auth.login,
    register: auth.register,
    logout: auth.logout,
    reload: auth.reload,
    forgotPassword: auth.forgotPassword,
    resetPassword: auth.resetPassword,
  }
}

// Renders children only for a logged-in user. This hides pages; it does not
// protect data. The API routes behind requireAuth do that.
export function RequireAuth({ children, fallback = null, loading = null }) {
  const { status } = useAuth()
  if (status === 'loading') return createElement(Fragment, null, loading)
  if (status !== 'authenticated') return createElement(Fragment, null, fallback)
  return createElement(Fragment, null, children)
}

// The reverse of RequireAuth, for pages like login and register that a
// logged-in user should not see.
export function GuestOnly({ children, fallback = null, loading = null }) {
  const { status } = useAuth()
  if (status === 'loading') return createElement(Fragment, null, loading)
  if (status === 'authenticated') return createElement(Fragment, null, fallback)
  return createElement(Fragment, null, children)
}

const IDLE = { data: null, error: null, errors: null, status: null, ok: false }

function isGet(options) {
  return !options?.method || String(options.method).toUpperCase() === 'GET'
}

// Data a server render loaded for `url`, embedded in the page. Read from
// globalThis, like the session in @tylix/client (the same object as window
// in a browser).
function serverRenderedData(url) {
  const data = globalThis.__TYLIX_DATA__
  return url != null && data && Object.hasOwn(data, url) ? data[url] : undefined
}

// Fetches `url` when the component mounts and whenever `url` changes.
// Pass null to skip fetching (for example until an id is known).
// The request is cancelled if the component unmounts first.
//
// With SSR, GET requests are loaded on the server and the page arrives with
// their data; in the browser the first render reuses it instead of fetching.
export function useApi(url, options) {
  const server = useContext(ServerContext)

  const [result, setResult] = useState(() => {
    if (url == null) return { ...IDLE, loading: false }
    if (server && isGet(options)) {
      if (server.cache.has(url)) return { ...server.cache.get(url), loading: false }
      // Ask the server renderer to load it, then render again.
      server.pending.add(url)
      return { ...IDLE, loading: true }
    }
    const preloaded = serverRenderedData(url)
    if (preloaded) return { ...preloaded, loading: false }
    return { ...IDLE, loading: true }
  })

  // The url whose data came with the server-rendered page, if any. Effects
  // for that url have nothing to fetch, however often they run (StrictMode
  // runs them twice in development); a different url fetches as usual.
  const serverRenderedUrl = useRef(!server && serverRenderedData(url) !== undefined ? url : null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const runRef = useRef(0)
  const controllerRef = useRef(null)

  const run = useCallback(async () => {
    if (url == null) return null
    const id = ++runRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setResult((prev) => ({ ...prev, loading: true }))
    const response = await api(url, { ...optionsRef.current, signal: controller.signal })
    // Only the latest request may update state.
    if (id === runRef.current && !response.aborted) {
      setResult({ ...response, loading: false })
    }
    return response
  }, [url])

  useEffect(() => {
    if (url == null) {
      setResult({ ...IDLE, loading: false })
      return undefined
    }
    if (serverRenderedUrl.current === url) {
      // Used by this component only: a later mount of the same url fetches
      // fresh data.
      if (globalThis.__TYLIX_DATA__) delete globalThis.__TYLIX_DATA__[url]
      return undefined
    }
    serverRenderedUrl.current = null
    run()
    return () => {
      runRef.current++
      controllerRef.current?.abort()
    }
  }, [url, run])

  return { ...result, reload: run }
}
