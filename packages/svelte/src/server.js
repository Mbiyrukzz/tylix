// Server-side rendering for Tylix Svelte apps. Imported only by the app's
// entry-server file, so the server renderer never reaches the browser.
import { render } from 'svelte/server'
import { resultFromResponse } from '@tylix/client'
import { serverContextKey } from './index.js'

// Renders the `App` component for one request, loading the API data its
// components ask for through useApi. Svelte renders synchronously, so:
//
//   1. render; every useApi GET without data registers its url
//   2. load those urls (load(url) -> { status, data }), render again
//   3. repeat until nothing new is asked for (or maxPasses)
//
// Resolves { html, head, status, redirect, data } for the Tylix host:
// `data` is embedded in the page so the browser's first render reuses it.
//
// A component can change the response through useServerContext():
//   server.status = 404           e.g. a not-found page
//   server.redirect = '/login'    sent as a 302 instead of the page
export async function renderWithData(App, { url = '/', session = null, load, props = {}, maxPasses = 4 } = {}) {
  const location = new URL(url, 'http://tylix.local')
  const context = {
    authState: session?.user
      ? { status: 'authenticated', user: session.user }
      : { status: 'guest', user: null },
    route: { path: location.pathname, search: location.search, query: location.searchParams },
    cache: new Map(),
    pending: new Set(),
    status: 200,
    redirect: null,
  }

  let output = { body: '', head: '' }
  for (let pass = 1; ; pass++) {
    context.pending.clear()
    context.status = 200
    context.redirect = null
    // Svelte renders lazily, when body/head are read, and render() may
    // return a thenable. Await it and read both now, so the components have
    // run (and registered what they need) before deciding on another pass.
    const result = await render(App, { props, context: new Map([[serverContextKey, context]]) })
    output = { body: result.body, head: result.head }

    const done = context.redirect || context.pending.size === 0 || !load || pass >= maxPasses
    if (done) break

    await Promise.all(
      [...context.pending].map(async (pendingUrl) => {
        const { status, data } = await load(pendingUrl)
        context.cache.set(pendingUrl, resultFromResponse(status, data))
      }),
    )
  }

  return {
    html: output.body,
    head: output.head,
    status: context.status,
    redirect: context.redirect,
    data: Object.fromEntries(context.cache),
  }
}
