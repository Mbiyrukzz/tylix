// Server-side rendering for Tylix React apps. Imported only by the app's
// entry-server file, so react-dom/server never reaches the browser bundle.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { resultFromResponse } from '@tylix/client'
import { ServerContext } from './index.js'

// Renders the element `render()` returns, loading the API data its
// components ask for through useApi:
//
//   1. render; every useApi GET without data registers its url
//   2. load those urls (load(url) -> { status, data }), render again
//   3. repeat until nothing new is asked for (or maxPasses)
//
// Each pass is a full renderToString, so a page that loads data in a chain
// (a list, then details for the first item) costs one pass per link.
// Resolves { html, status, redirect, data } for the Tylix host: `data` is
// embedded in the page so the browser's first render reuses it.
//
// A component can change the response through useServerContext():
//   server.status = 404           e.g. a not-found page
//   server.redirect = '/login'    sent as a 302, nothing rendered
export async function renderWithData(render, { session = null, load, maxPasses = 4 } = {}) {
  const context = {
    authState: session?.user
      ? { status: 'authenticated', user: session.user }
      : { status: 'guest', user: null },
    cache: new Map(),
    pending: new Set(),
    status: 200,
    redirect: null,
  }

  let html = ''
  for (let pass = 1; ; pass++) {
    context.pending.clear()
    context.status = 200
    context.redirect = null
    html = renderToString(createElement(ServerContext.Provider, { value: context }, render()))

    const done = context.redirect || context.pending.size === 0 || !load || pass >= maxPasses
    if (done) break

    await Promise.all(
      [...context.pending].map(async (url) => {
        const { status, data } = await load(url)
        context.cache.set(url, resultFromResponse(status, data))
      }),
    )
  }

  return {
    html,
    status: context.status,
    redirect: context.redirect,
    data: Object.fromEntries(context.cache),
  }
}
