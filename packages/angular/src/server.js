// Server-side rendering for Tylix Angular apps. Imported only by the app's
// entry-server file, so @angular/platform-server never reaches the browser.
import { renderApplication } from '@angular/platform-server'
import { TYLIX_SERVER } from './index.js'

// Angular skips browser-only work (event replay, which touches `window`)
// when ngServerMode is set. The Angular CLI defines it for server bundles;
// Vite doesn't, so it is set here. This module only ever runs in the
// server process, never in a browser.
globalThis.ngServerMode = true

// Angular renders a whole document. This minimal one only hosts the app;
// the head and body it produces go into the app's own index.html.
const DOCUMENT = '<!doctype html><html><head></head><body><app-root></app-root></body></html>'

function between(html, open, close) {
  const start = html.search(open)
  if (start === -1) return ''
  const from = html.indexOf('>', start) + 1
  const end = html.lastIndexOf(close)
  return end > from ? html.slice(from, end) : ''
}

// The per-request context, provided to the app as TYLIX_SERVER.
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

// Renders the app for one request. `bootstrap` is the app's server
// bootstrap: (context) => bootstrapApplication(App, config, context).
// Every injectApi GET is loaded as a pending task, which Angular waits for,
// so one pass renders the page with its data.
//
// Resolves { html, head, status, redirect, data } for the Tylix host: html
// is the <app-root> element plus Angular's hydration state script, head is
// what Angular put in <head> (component styles), and data is embedded in
// the page so the browser's first render reuses it.
export async function renderWithData(bootstrap, { url = '/', session = null, load } = {}) {
  const context = createServerContext({ session, load })
  const document = await renderApplication(bootstrap, {
    document: DOCUMENT,
    url,
    platformProviders: [{ provide: TYLIX_SERVER, useValue: context }],
  })

  if (context.redirect) return { html: '', head: '', status: 302, redirect: context.redirect, data: {} }
  return {
    html: between(document, /<body[\s>]/i, '</body>'),
    head: between(document, /<head[\s>]/i, '</head>'),
    status: context.status,
    redirect: null,
    data: context.data,
  }
}
