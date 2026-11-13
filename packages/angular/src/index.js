// Angular bindings for the Tylix client: signals, functional guards and an
// HttpClient interceptor. Plain JavaScript with no decorators, so it needs
// no Angular compilation. The session logic itself (refresh, cross-tab
// sync) lives in @tylix/client, so every frontend behaves the same.
import {
  DestroyRef,
  InjectionToken,
  PendingTasks,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core'
import { Router } from '@angular/router'
import { HttpErrorResponse } from '@angular/common/http'
import { catchError, from, switchMap, throwError } from 'rxjs'
import { api, auth, lazyChannel, refreshSession, resultFromResponse } from '@tylix/client'
import { canRefreshAfter401, decideAccess, nextPath } from './access.js'

export { api, auth, nextPath, decideAccess }

// Provided only while a page renders on the server (see ./server.js): that
// request's session and loader, the data loaded so far, and what the render
// decided about the response (status, redirect).
export const TYLIX_SERVER = new InjectionToken('tylix:server')

// The server render's context while rendering on the server; null in the
// browser or outside an injection context.
//   const server = useServerContext()
//   if (server) server.status = 404
export function useServerContext() {
  try {
    return inject(TYLIX_SERVER, { optional: true })
  } catch {
    return null // not in an injection context
  }
}

// One signal mirror of the session, shared by every injectAuth() call in
// the browser. Never used on the server, where state is per request.
const sessionState = signal({ status: 'loading', user: null })
let mirrored = false

function mirrorSession() {
  if (!mirrored) {
    mirrored = true
    sessionState.set(auth.getState())
    auth.subscribe((state) => sessionState.set(state))
  }
  return auth.init()
}

// Resolves once the first session check is done.
export function sessionReady() {
  return mirrorSession()
}

function sessionSignals(state) {
  return {
    status: computed(() => state().status),
    user: computed(() => state().user),
    expired: computed(() => Boolean(state().expired)),
    loading: computed(() => state().status === 'loading'),
    isAuthenticated: computed(() => state().status === 'authenticated'),
  }
}

const browserSession = sessionSignals(sessionState)

// The current session as signals, plus the actions that change it. On the
// server (in an injection context) it is that request's session; in the
// browser the shared one, which main.ts initialised from the session the
// server put in the page, so hydration sees the same state.
export function injectAuth() {
  const server = useServerContext()
  if (!server) mirrorSession()
  const signals = server ? sessionSignals(signal(server.authState)) : browserSession
  return {
    ...signals,
    login: auth.login,
    register: auth.register,
    logout: auth.logout,
    reload: auth.reload,
    forgotPassword: auth.forgotPassword,
    resetPassword: auth.resetPassword,
  }
}

// False on the server and while a server-rendered page is hydrating; true
// after the first render in the browser. Before that, a form's submit
// button would do a native submit and reload the page, losing what was
// typed, so starter forms keep their buttons disabled until this is true.
// Call in an injection context.
export function injectHydrated() {
  const hydrated = signal(false)
  afterNextRender(() => hydrated.set(true))
  return hydrated.asReadonly()
}

// A live channel on the channel server ("tylix channels:work"). Call in an
// injection context (a field initializer):
//   chat = injectChannel<Message>('chat', (message) => ...)
//   this.chat.send({ text })   and   chat.status() in templates
// Connects after the first render in the browser (never on the server),
// reconnects on its own, and closes with the component.
export function injectChannel(name, onMessage) {
  const status = signal('connecting')
  const live = lazyChannel(name, { onMessage: (data) => onMessage?.(data), onStatus: (next) => status.set(next) })
  afterNextRender(() => live.open())
  inject(DestroyRef).onDestroy(() => live.close())
  return { send: (data) => live.send(data), status: status.asReadonly() }
}

// Data a server render loaded for `url`, embedded in the page.
function serverRenderedData(url) {
  const data = globalThis.__TYLIX_DATA__
  return url != null && data && Object.hasOwn(data, url) ? data[url] : undefined
}

function isGet(options) {
  return !options?.method || String(options.method).toUpperCase() === 'GET'
}

// Fetches `url` now and again whenever it changes. `url` is a string or a
// function of signals (() => `/api/posts/${this.id()}`); null skips. Call
// it in an injection context (a field initializer or constructor): the
// request is cancelled when the component is destroyed.
//
//   posts = injectApi<Post[]>('/api/posts')
//   @for (post of posts.data() ?? []; track post.id) { ... }
//
// With SSR, GET requests are loaded on the server as pending tasks, which
// Angular waits for before producing the HTML; the page arrives with their
// data and the browser reuses it instead of fetching again.
export function injectApi(url, options) {
  const data = signal(null)
  const error = signal(null)
  const errors = signal(null)
  const status = signal(null)
  const ok = signal(false)
  const loading = signal(false)

  const apply = (result) => {
    data.set(result.data)
    error.set(result.error)
    errors.set(result.errors)
    status.set(result.status)
    ok.set(result.ok)
    loading.set(false)
  }

  const urlOf = typeof url === 'function' ? url : () => url
  const server = useServerContext()
  const pendingTasks = server ? inject(PendingTasks) : null

  let controller = null
  let runId = 0

  async function load(current) {
    if (current == null) {
      loading.set(false)
      return null
    }
    const id = ++runId

    if (server) {
      if (!isGet(options)) return null
      // A pending task: Angular waits for it before producing the HTML.
      const done = pendingTasks.add()
      try {
        loading.set(true)
        const { status: code, data: body } = await server.load(current)
        const result = resultFromResponse(code, body)
        server.data[current] = result
        if (id === runId) apply(result)
        return result
      } finally {
        done()
      }
    }

    controller?.abort()
    controller = new AbortController()
    loading.set(true)
    const response = await api(current, { ...options, signal: controller.signal })
    if (id === runId && !response.aborted) apply(response)
    return response
  }

  // The url whose data came with the server-rendered page: shown at once,
  // used instead of the first fetch, then dropped so a later mount fetches.
  let serverRenderedUrl = null
  if (!server && typeof url !== 'function') {
    const preloaded = serverRenderedData(url)
    if (preloaded) {
      apply(preloaded)
      serverRenderedUrl = url
    }
  }

  // Re-runs when a signal read by urlOf changes. The request itself runs
  // untracked, so signals it sets don't loop back into this effect.
  effect(() => {
    const current = urlOf()
    untracked(() => {
      if (!server && current != null && serverRenderedUrl === null) {
        // A url built from signals (e.g. a route input) is only known here.
        const preloaded = serverRenderedData(current)
        if (preloaded && data() === null) {
          apply(preloaded)
          serverRenderedUrl = current
        }
      }
      if (current != null && current === serverRenderedUrl) {
        if (globalThis.__TYLIX_DATA__) delete globalThis.__TYLIX_DATA__[current]
        serverRenderedUrl = undefined
        return
      }
      load(current)
    })
  })

  inject(DestroyRef).onDestroy(() => {
    runId++
    controller?.abort()
  })

  return {
    data: data.asReadonly(),
    error: error.asReadonly(),
    errors: errors.asReadonly(),
    status: status.asReadonly(),
    ok: ok.asReadonly(),
    loading: loading.asReadonly(),
    reload: () => load(untracked(urlOf)),
  }
}

function guard(access) {
  return async (route, state) => {
    const router = inject(Router)
    const server = useServerContext()
    const status = server ? server.authState.status : (await sessionReady(), auth.getState().status)
    const decision = decideAccess(access, status, state.url, route.queryParamMap.get('next'))
    if (!decision) return true

    const target = decision.login ? `/login?next=${encodeURIComponent(decision.login)}` : decision.to
    if (server) {
      // Answered with a 302 by the Tylix host; nothing is rendered.
      server.redirect = target
      return false
    }
    return router.parseUrl(target)
  }
}

// canActivate: [authGuard] for pages that need a logged-in user. Waits for
// the first session check, then sends guests to /login?next=<this page>
// (a 302 when rendering on the server). Hides pages only; the API's
// requireAuth protects the data.
export const authGuard = guard('auth')

// canActivate: [guestGuard] for login/register: a logged-in user goes to
// ?next= or the dashboard.
export const guestGuard = guard('guest')

// For apps that use HttpClient: sends the session cookies, and on a 401
// renews the session once (shared with api()) and retries the request.
//
//   provideHttpClient(withFetch(), withInterceptors([tylixInterceptor]))
export function tylixInterceptor(request, next) {
  const withCookies = request.clone({ withCredentials: true })
  return next(withCookies).pipe(
    catchError((err) => {
      const retryable = err instanceof HttpErrorResponse && err.status === 401 && canRefreshAfter401(request.url)
      if (!retryable) return throwError(() => err)
      return from(refreshSession()).pipe(
        switchMap((renewed) => (renewed ? next(withCookies) : throwError(() => err))),
      )
    }),
  )
}
