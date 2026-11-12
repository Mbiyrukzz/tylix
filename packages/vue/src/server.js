// Server-side rendering for Tylix Vue apps. Imported only by the app's
// entry-server file, so the server renderer never reaches the browser.
import { renderToString } from 'vue/server-renderer'
import { serverContextKey } from './index.js'

// Renders `app` (a fresh createSSRApp() for this request) to HTML with the
// request's server context (createServerContext below). Every useApi GET in
// the rendered components is loaded through context.load with
// onServerPrefetch, which Vue awaits, so one pass renders the page with its
// data. Resolves { html, status, redirect, data } for the Tylix host; `data`
// is embedded in the page so the browser's first render reuses it.
//
// A component can change the response through useServerContext():
//   server.status = 404           e.g. a not-found page
//   server.redirect = '/login'    sent as a 302 instead of the page
export async function renderWithData(app, context) {
  app.provide(serverContextKey, context)
  const html = await renderToString(app)
  if (context.redirect) return { html: '', status: 302, redirect: context.redirect, data: {} }
  return { html, status: context.status, redirect: null, data: context.data }
}

// The per-request context, created before the app so router guards can
// read the visitor's session (context.authState) too.
export function createServerContext({ session = null, load } = {}) {
  return {
    authState: session?.user
      ? { status: 'authenticated', user: session.user }
      : { status: 'guest', user: null },
    load: load ?? (async () => ({ status: 404, data: { error: 'Not found' } })),
    data: {},
    status: 200,
    redirect: null,
  }
}
