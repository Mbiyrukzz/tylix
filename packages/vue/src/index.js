// Vue bindings for the Tylix client, as composables returning refs. The
// session logic itself (refresh, cross-tab sync) lives in @tylix/client,
// so every frontend behaves the same.
import {
  computed,
  defineComponent,
  getCurrentInstance,
  getCurrentScope,
  inject,
  onErrorCaptured,
  onMounted,
  onScopeDispose,
  onServerPrefetch,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import { api, auth, lazyChannel, resultFromResponse } from '@tylix/client'

export { api, auth }

// Provided to the app only while a page renders on the server (see
// ./server.js): that request's session and loader, the data loaded so far,
// and what the render decided about the response (status, redirect).
export const serverContextKey = Symbol('tylix:server')

// For components that affect the server response during SSR:
//   const server = useServerContext()
//   if (server) server.status = 404
// Always null in the browser.
export function useServerContext() {
  return getCurrentInstance() ? inject(serverContextKey, null) : null
}

// One Vue-reactive mirror of the session, shared by every useAuth() call in
// the browser. Never used on the server, where state is per request.
const sessionState = shallowRef({ status: 'loading', user: null })
let mirrored = false

function mirrorSession() {
  if (!mirrored) {
    mirrored = true
    sessionState.value = auth.getState()
    auth.subscribe((state) => {
      sessionState.value = state
    })
  }
  return auth.init()
}

// Resolves once the first session check is done. Router guards await this
// so they never decide on a session that is still loading.
export function sessionReady() {
  return mirrorSession()
}

// The current session plus the actions that change it. All values are
// computed refs, so templates and watchers update when the session does.
export function useAuth() {
  const server = useServerContext()
  // On the server, this request's session. In the browser, the shared
  // mirror, which main.js initialised from the session the server put in
  // the page, so hydration sees the same state.
  const state = server ? shallowRef(server.authState) : (mirrorSession(), sessionState)
  return {
    status: computed(() => state.value.status),
    user: computed(() => state.value.user),
    expired: computed(() => Boolean(state.value.expired)),
    loading: computed(() => state.value.status === 'loading'),
    isAuthenticated: computed(() => state.value.status === 'authenticated'),
    login: auth.login,
    register: auth.register,
    logout: auth.logout,
    reload: auth.reload,
    forgotPassword: auth.forgotPassword,
    resetPassword: auth.resetPassword,
  }
}

// A live channel on the channel server ("tylix channels:work"):
//   const { send, status } = useChannel('chat', (message) => ...)
// Connects once mounted (never during server rendering), reconnects on its
// own, and closes with the component. send() before then is queued.
export function useChannel(name, onMessage) {
  const status = ref('connecting')
  const live = lazyChannel(toValue(name), {
    onMessage: (data) => onMessage?.(data),
    onStatus: (next) => {
      status.value = next
    },
  })
  if (getCurrentInstance()) onMounted(() => live.open())
  if (getCurrentScope()) onScopeDispose(() => live.close())
  return { send: (data) => live.send(data), status }
}

// False on the server and while a server-rendered page is hydrating; true
// once mounted. Before that, a form's submit button would do a native
// submit and reload the page, losing what was typed, so starter forms keep
// their buttons disabled until this is true.
export function useHydrated() {
  const hydrated = ref(false)
  onMounted(() => {
    hydrated.value = true
  })
  return hydrated
}

// Catches errors thrown by the components inside it (render, setup,
// lifecycle hooks, watchers) and shows the `fallback` slot instead:
//
//   <ErrorBoundary :reset-key="route.fullPath">
//     <RouterView />
//     <template #fallback="{ error, reset }"><ErrorPage :error="error" :reset="reset" /></template>
//   </ErrorBoundary>
//
// reset() renders the default slot again, and so does a change of
// `resetKey` (the URL, usually), so navigating away from a broken page
// recovers. The error stops here: it is passed to `onError` but does not
// reach app.config.errorHandler.
export const ErrorBoundary = defineComponent({
  name: 'TylixErrorBoundary',
  props: {
    resetKey: { type: null, default: undefined },
    onError: { type: Function, default: undefined },
  },
  setup(props, { slots }) {
    const error = shallowRef(null)
    const reset = () => {
      error.value = null
    }
    watch(() => props.resetKey, reset)
    onErrorCaptured((err, instance, info) => {
      error.value = err ?? new Error('Unknown error')
      props.onError?.(err, info)
      return false
    })
    return () => (error.value ? slots.fallback?.({ error: error.value, reset }) : slots.default?.())
  },
})

function isGet(options) {
  const method = toValue(options)?.method
  return !method || String(method).toUpperCase() === 'GET'
}

// Data a server render loaded for `url`, embedded in the page.
function serverRenderedData(url) {
  const data = globalThis.__TYLIX_DATA__
  return url != null && data && Object.hasOwn(data, url) ? data[url] : undefined
}

// Fetches `url` now and whenever it changes. `url` may be a string, a ref
// or a getter; null skips fetching. Leaving the component (its effect
// scope) cancels a request still in flight.
//
//   const { data, loading, error, reload } = useApi('/api/posts')
//   const post = useApi(() => `/api/public/posts/${route.params.id}`)
//
// With SSR, GET requests are loaded on the server (onServerPrefetch) and
// the page arrives with their data; in the browser it is reused instead of
// fetched again.
export function useApi(url, options) {
  const data = shallowRef(null)
  const error = ref(null)
  const errors = shallowRef(null)
  const status = ref(null)
  const ok = ref(false)
  const loading = ref(toValue(url) != null)

  const apply = (result) => {
    data.value = result.data
    error.value = result.error
    errors.value = result.errors
    status.value = result.status
    ok.value = result.ok
    loading.value = false
  }

  const server = useServerContext()
  if (server) {
    const current = toValue(url)
    if (current != null && isGet(options)) {
      onServerPrefetch(async () => {
        const { status: code, data: body } = await server.load(current)
        const result = resultFromResponse(code, body)
        server.data[current] = result
        apply(result)
      })
    }
    return { data, error, errors, status, ok, loading, reload: async () => null }
  }

  let controller = null
  let runId = 0

  async function reload() {
    const current = toValue(url)
    if (current == null) {
      loading.value = false
      return null
    }
    const id = ++runId
    controller?.abort()
    controller = new AbortController()
    loading.value = true
    const response = await api(current, { ...toValue(options), signal: controller.signal })
    // Only the latest request may update state.
    if (id === runId && !response.aborted) apply(response)
    return response
  }

  // The url whose data came with the server-rendered page: used instead of
  // a first fetch, then dropped so a later mount fetches fresh data.
  let serverRenderedUrl = null
  const preloaded = serverRenderedData(toValue(url))
  if (preloaded) {
    apply(preloaded)
    serverRenderedUrl = toValue(url)
    delete globalThis.__TYLIX_DATA__[serverRenderedUrl]
  }

  watch(
    () => toValue(url),
    (current) => {
      if (current != null && current === serverRenderedUrl) {
        serverRenderedUrl = null
        return
      }
      reload()
    },
    { immediate: true },
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      runId++
      controller?.abort()
    })
  }

  return { data, error, errors, status, ok, loading, reload }
}
