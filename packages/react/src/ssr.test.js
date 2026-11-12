import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
after(() => dom.window.close())

// Browser-side fetches are counted: hydration must not refetch.
const browserFetches = []
globalThis.fetch = async (url) => {
  browserFetches.push(new URL(url, 'http://x').pathname)
  return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
}

const { createElement: h, act, StrictMode } = await import('react')
const { hydrateRoot } = await import('react-dom/client')
const { useApi, useAuth, useServerContext, auth } = await import('./index.js')
const { renderWithData } = await import('./server.js')

// A fake in-process API, as the Tylix host's load() would answer.
const loaded = []
async function load(url) {
  loaded.push(url)
  if (url === '/api/posts') return { status: 200, data: [{ id: 1, title: 'First' }] }
  if (url === '/api/posts/1/comments') return { status: 200, data: ['Nice'] }
  return { status: 404, data: { error: 'Not found' } }
}

function Comments({ postId }) {
  const comments = useApi(`/api/posts/${postId}/comments`)
  return h('em', null, comments.loading ? '…' : comments.data.join(','))
}

function Page() {
  const { user } = useAuth()
  const posts = useApi('/api/posts')
  if (posts.loading) return h('p', null, 'loading')
  // Depends on the first request: needs a second load pass.
  return h(
    'div',
    null,
    h('h1', null, user ? `Hi ${user.name}` : 'Hi guest'),
    posts.data.map((p) => h('section', { key: p.id }, p.title, ' ', h(Comments, { postId: p.id }))),
  )
}

test('loads data across passes and renders it, as the session user', async () => {
  const out = await renderWithData(() => h(Page), { session: { user: { id: 1, name: 'Ada' } }, load })
  // <!-- --> is React's marker between adjacent text nodes.
  assert.equal(out.html, '<div><h1>Hi Ada</h1><section>First<!-- --> <em>Nice</em></section></div>')
  assert.equal(out.status, 200)
  assert.equal(out.redirect, null)
  assert.deepEqual(Object.keys(out.data), ['/api/posts', '/api/posts/1/comments'])
  assert.deepEqual(out.data['/api/posts'], { ok: true, status: 200, data: [{ id: 1, title: 'First' }], error: null, errors: null })
})

test('a guest session renders guest UI, never "loading"', async () => {
  const out = await renderWithData(() => h(Page), { session: { user: null }, load })
  assert.match(out.html, /Hi guest/)
})

test('API errors become the same result useApi gives in the browser', async () => {
  function Missing() {
    const r = useApi('/api/nope')
    return h('p', null, r.loading ? 'loading' : `${r.status} ${r.error}`)
  }
  const out = await renderWithData(() => h(Missing), { load })
  assert.equal(out.html, '<p>404 Not found</p>')
})

test('components set the status or redirect through useServerContext', async () => {
  function NotFound() {
    const server = useServerContext()
    if (server) server.status = 404
    return h('h1', null, 'Page not found')
  }
  const notFound = await renderWithData(() => h(NotFound), { load })
  assert.equal(notFound.status, 404)

  function GoAway() {
    const server = useServerContext()
    if (server) server.redirect = '/login?next=%2Fdashboard'
    return null
  }
  const redirect = await renderWithData(() => h('div', null, h(GoAway), h(Page)), { load })
  assert.equal(redirect.redirect, '/login?next=%2Fdashboard')
})

test('the browser hydrates server HTML with its data: no refetch, no mismatch', async () => {
  const out = await renderWithData(() => h(Page), { session: { user: { id: 1, name: 'Ada' } }, load })

  // What the Tylix host puts in the page.
  globalThis.__TYLIX_SESSION__ = { user: { id: 1, name: 'Ada' } }
  globalThis.__TYLIX_SSR__ = true
  globalThis.__TYLIX_DATA__ = out.data
  const container = document.getElementById('root')
  container.innerHTML = out.html

  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    auth.init() // as main.jsx does before hydrating
    await act(async () => {
      // StrictMode, as the starter's main.jsx uses: it runs effects twice in
      // development, which must still not refetch server-rendered data.
      hydrateRoot(container, h(StrictMode, null, h(Page)), { onRecoverableError: (err) => errors.push(String(err)) })
    })
  } finally {
    console.error = original
  }

  assert.deepEqual(errors, [], 'no hydration mismatch')
  assert.equal(container.innerHTML, out.html)
  assert.deepEqual(browserFetches, [], 'no request repeated in the browser')
  assert.deepEqual(Object.keys(globalThis.__TYLIX_DATA__), [], 'embedded data is used once')
})
