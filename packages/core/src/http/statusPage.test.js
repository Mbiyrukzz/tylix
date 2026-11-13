import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../router/Router.js'
import { Server } from './Server.js'
import { renderStatusPage } from './statusPage.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger } }

async function withServer(router, options, fn) {
  const server = new Server(router, { logger: silentLogger, accessLog: false, ...options })
  const httpServer = server.listen(0)
  await new Promise((resolve) => httpServer.once('listening', resolve))
  const { port } = httpServer.address()
  try {
    await fn(`http://localhost:${port}`)
  } finally {
    httpServer.close()
  }
}

const browser = { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } }

test('a crash without debug gives a browser a 500 page with the request id, and API clients JSON', async () => {
  const router = new Router()
  router.get('/boom', () => {
    throw new Error('secret detail')
  })
  router.get('/api/boom', () => {
    throw new Error('secret detail')
  })
  await withServer(router, { debug: false }, async (base) => {
    const page = await fetch(`${base}/boom`, browser)
    const html = await page.text()
    assert.equal(page.status, 500)
    assert.match(page.headers.get('content-type'), /text\/html/)
    assert.match(html, /Something went wrong/)
    assert.doesNotMatch(html, /secret detail/)
    const requestId = page.headers.get('x-request-id')
    assert.ok(requestId && html.includes(requestId), 'the page shows the request id')

    const api = await fetch(`${base}/api/boom`)
    assert.equal(api.status, 500)
    assert.ok((await api.json()).error)
  })
})

test('an unmatched browser navigation gets a 404 page; fetch keeps the JSON 404', async () => {
  await withServer(new Router(), {}, async (base) => {
    const page = await fetch(`${base}/nowhere`, browser)
    assert.equal(page.status, 404)
    assert.match(await page.text(), /Page not found/)

    const api = await fetch(`${base}/nowhere`)
    assert.equal(api.status, 404)
    assert.deepEqual(await api.json(), { error: 'Not found' })
  })
})

test('the status page escapes what it shows', () => {
  const html = renderStatusPage({ title: '<b>x</b>', message: '"m"', requestId: 'id<1>', actions: [{ label: 'a', href: '/p?q="1"' }] })
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'))
  assert.ok(html.includes('id&lt;1&gt;'))
  assert.ok(!html.includes('<b>x</b>'))
})
