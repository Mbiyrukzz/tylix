import { test } from 'node:test'
import assert from 'node:assert/strict'

// Server rendering with the real @angular/platform-server. Hydration is
// covered by the e2e parity suite in a real browser.
await import('@angular/compiler') // JIT: these test components aren't AOT-compiled
const { Component, inject, provideZonelessChangeDetection } = await import('@angular/core')
const { bootstrapApplication } = await import('@angular/platform-browser')
const { provideServerRendering } = await import('@angular/platform-server')
const { injectApi, injectAuth, useServerContext } = await import('./index.js')
const { renderWithData } = await import('./server.js')

async function load(url) {
  if (url === '/api/posts') return { status: 200, data: [{ id: 1, title: 'First' }] }
  return { status: 404, data: { error: 'Not found' } }
}

class PageImpl {
  auth = injectAuth()
  posts = injectApi('/api/posts')
  missing = injectApi('/api/nope')
}
const Page = Component({
  selector: 'app-root',
  template: `<h1>{{ auth.user() ? 'Hi ' + auth.user()!.name : 'Hi guest' }}</h1>
@for (p of posts.data() ?? []; track p.id) {<li>{{ p.title }}</li>}
<em>{{ missing.status() }} {{ missing.error() }}</em>`,
})(PageImpl)

class NotFoundImpl {
  constructor() {
    const server = useServerContext()
    if (server) server.status = 404
  }
}
const NotFound = Component({ selector: 'app-root', template: '<h1>Page not found</h1>' })(NotFoundImpl)

const bootstrapOf = (App) => (context) =>
  bootstrapApplication(App, { providers: [provideZonelessChangeDetection(), provideServerRendering()] }, context)

const text = (html) => html.replace(/<!--[^>]*-->/g, '').replace(/<script[\s\S]*<\/script>/, '')

test('renders with its data in one pass, as the session user', async () => {
  const out = await renderWithData(bootstrapOf(Page), { url: '/', session: { user: { id: 1, name: 'Ada' } }, load })
  assert.match(text(out.html), /Hi Ada/)
  assert.match(text(out.html), /<li>First<\/li>/)
  assert.match(text(out.html), /404 Not found/)
  // The <app-root> element itself (the host swaps it in for index.html's).
  assert.match(out.html, /^<app-root[^>]*ng-server-context=/)
  assert.equal(out.status, 200)
  assert.deepEqual(Object.keys(out.data).sort(), ['/api/nope', '/api/posts'])
})

test('a guest renders guest UI', async () => {
  const out = await renderWithData(bootstrapOf(Page), { session: { user: null }, load })
  assert.match(out.html, /Hi guest/)
})

test('a component sets the status through useServerContext', async () => {
  const out = await renderWithData(bootstrapOf(NotFound), { load })
  assert.equal(out.status, 404)
})

test('concurrent renders keep their own session', async () => {
  const [a, b] = await Promise.all([
    renderWithData(bootstrapOf(Page), { session: { user: { id: 1, name: 'Ada' } }, load }),
    renderWithData(bootstrapOf(Page), { session: { user: { id: 2, name: 'Grace' } }, load }),
  ])
  assert.match(a.html, /Hi Ada/)
  assert.match(b.html, /Hi Grace/)
})
