import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.SVGElement = dom.window.SVGElement
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
after(() => dom.window.close())

const browserFetches = []
globalThis.fetch = async (url) => {
  browserFetches.push(new URL(url, 'http://x').pathname)
  return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
}

const { createSSRApp, defineComponent, h, nextTick } = await import('vue')
const { useApi, useAuth, useServerContext, auth } = await import('./index.js')
const { createServerContext, renderWithData } = await import('./server.js')

async function load(url) {
  if (url === '/api/posts') return { status: 200, data: [{ id: 1, title: 'First' }] }
  return { status: 404, data: { error: 'Not found' } }
}

const Page = defineComponent({
  setup() {
    const { user } = useAuth()
    const { data, loading } = useApi('/api/posts')
    const missing = useApi('/api/nope')
    return () =>
      h('div', [
        h('h1', user.value ? `Hi ${user.value.name}` : 'Hi guest'),
        loading.value ? h('p', 'loading') : h('ul', data.value.map((p) => h('li', { key: p.id }, p.title))),
        h('em', missing.loading.value ? '…' : `${missing.status.value} ${missing.error.value}`),
      ])
  },
})

test('renders with its data in one pass, as the session user', async () => {
  const context = createServerContext({ session: { user: { id: 1, name: 'Ada' } }, load })
  const out = await renderWithData(createSSRApp(Page), context)
  assert.equal(out.html, '<div><h1>Hi Ada</h1><ul><li>First</li></ul><em>404 Not found</em></div>')
  assert.equal(out.status, 200)
  assert.deepEqual(Object.keys(out.data).sort(), ['/api/nope', '/api/posts'])
  assert.deepEqual(out.data['/api/posts'], { ok: true, status: 200, data: [{ id: 1, title: 'First' }], error: null, errors: null })
})

test('a guest renders guest UI', async () => {
  const out = await renderWithData(createSSRApp(Page), createServerContext({ session: { user: null }, load }))
  assert.match(out.html, /Hi guest/)
})

test('components set the status or redirect through useServerContext', async () => {
  const NotFound = defineComponent({
    setup() {
      const server = useServerContext()
      if (server) server.status = 404
      return () => h('h1', 'Page not found')
    },
  })
  const notFound = await renderWithData(createSSRApp(NotFound), createServerContext({ load }))
  assert.equal(notFound.status, 404)

  const GoAway = defineComponent({
    setup() {
      const server = useServerContext()
      if (server) server.redirect = '/login'
      return () => null
    },
  })
  const redirect = await renderWithData(createSSRApp(GoAway), createServerContext({ load }))
  assert.equal(redirect.redirect, '/login')
})

test('the browser hydrates server HTML with its data: no refetch, no mismatch', async () => {
  const context = createServerContext({ session: { user: { id: 1, name: 'Ada' } }, load })
  const out = await renderWithData(createSSRApp(Page), context)

  globalThis.__TYLIX_SESSION__ = { user: { id: 1, name: 'Ada' } }
  globalThis.__TYLIX_SSR__ = true
  globalThis.__TYLIX_DATA__ = out.data
  const container = document.getElementById('app')
  container.innerHTML = out.html

  const warnings = []
  const warn = console.warn
  const error = console.error
  console.warn = (...args) => warnings.push(args.join(' '))
  console.error = (...args) => warnings.push(args.join(' '))
  try {
    auth.init() // as main.js does before mounting
    const app = createSSRApp(Page)
    app.config.warnHandler = (msg) => warnings.push(msg)
    app.mount(container)
    await nextTick()
  } finally {
    console.warn = warn
    console.error = error
  }

  assert.deepEqual(warnings, [], 'no hydration mismatch')
  assert.equal(container.innerHTML, out.html)
  assert.deepEqual(browserFetches, [], 'no request repeated in the browser')
})
