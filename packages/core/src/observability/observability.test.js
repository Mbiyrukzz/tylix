import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createLogger } from './logger.js'
import { createRegistry } from './metrics.js'
import { currentRequest, requestContext } from './context.js'
import { Router } from '../router/Router.js'
import { Server } from '../http/Server.js'

const sink = () => {
  const lines = []
  return { lines, write: (text) => lines.push(text) }
}

test('logger: levels, JSON lines, child fields, errors, request id from context', () => {
  const out = sink()
  const log = createLogger({ level: 'info', format: 'json', stream: out, buffer: false })
  log.debug('hidden')
  log.info('hello', { a: 1 })
  log.child({ job: 'Send' }).error('boom', { error: new Error('bad') })
  requestContext.run({ requestId: 'req-1' }, () => log.warn('inside'))
  const [hello, boom, inside] = out.lines.map((line) => JSON.parse(line))
  assert.equal(out.lines.length, 3)
  assert.deepEqual({ level: hello.level, msg: hello.msg, a: hello.a }, { level: 'info', msg: 'hello', a: 1 })
  assert.equal(boom.job, 'Send')
  assert.equal(boom.error.message, 'bad')
  assert.ok(boom.error.stack)
  assert.equal(inside.requestId, 'req-1')
  assert.throws(() => createLogger({ level: 'loud' }), /Unknown log level/)
})

test('logger: pretty lines and configure()', () => {
  const out = sink()
  const log = createLogger({ format: 'pretty', stream: out, colors: false, buffer: false })
  log.info('Invoice sent', { id: 12, to: 'a b' })
  assert.match(out.lines[0], /^\d\d:\d\d:\d\d INFO  Invoice sent  id=12 to="a b"\n$/)
  log.configure({ level: 'error' })
  log.warn('quiet now')
  assert.equal(out.lines.length, 1)
})

test('metrics: counters, gauges and cumulative histograms in Prometheus format', () => {
  const registry = createRegistry()
  const sent = registry.counter('sent_total', 'Sent')
  sent.inc({ channel: 'email' })
  sent.inc({ channel: 'email' }, 2)
  registry.gauge('queue_depth', 'Jobs waiting', () => 7)
  const timer = registry.histogram('work_seconds', 'Work', [0.1, 1])
  timer.observe(0.05)
  timer.observe(0.5)
  timer.observe(5)
  const text = registry.render()
  assert.match(text, /# TYPE sent_total counter\nsent_total\{channel="email"\} 3/)
  assert.match(text, /queue_depth 7/)
  assert.match(text, /work_seconds_bucket\{le="0.1"\} 1\nwork_seconds_bucket\{le="1"\} 2\nwork_seconds_bucket\{le="\+Inf"\} 3/)
  assert.match(text, /work_seconds_count 3/)
  assert.equal(registry.counter('sent_total', 'Sent'), sent, 'defining again returns the same metric')
  assert.throws(() => registry.gauge('sent_total', 'x'), /already exists/)
})

async function serve(router, options) {
  const server = new Server(router, { autoPort: false, ...options })
  const httpServer = await new Promise((resolve) => {
    const s = server.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${httpServer.address().port}`
  return { base, close: () => new Promise((r) => httpServer.close(r)) }
}

test('server: request ids, context in handlers, access log, metrics, slow requests', async () => {
  const out = sink()
  const logger = createLogger({ format: 'json', stream: out, buffer: false })
  const registry = createRegistry()
  const router = new Router()
  router.get('/api/posts/:id', (req, res) => res.json({ id: req.params.id, ctx: currentRequest()?.requestId }))
  router.get('/api/slow', async (req, res) => {
    await new Promise((r) => setTimeout(r, 30))
    res.json({ ok: true })
  })
  const app = await serve(router, { logger, metrics: registry, accessLog: 'api', slowRequestMs: 20 })
  try {
    const first = await fetch(`${app.base}/api/posts/7`)
    const body = await first.json()
    assert.match(first.headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
    assert.equal(body.ctx, first.headers.get('x-request-id'), 'handlers see their request id')
    const kept = await fetch(`${app.base}/api/posts/8`, { headers: { 'x-request-id': 'client-abc' } })
    assert.equal(kept.headers.get('x-request-id'), 'client-abc')
    const replaced = await fetch(`${app.base}/api/posts/9`, { headers: { 'x-request-id': 'bad id with spaces' } })
    assert.notEqual(replaced.headers.get('x-request-id'), 'bad id with spaces')
    await fetch(`${app.base}/api/slow`)
    await fetch(`${app.base}/nope`)
    await new Promise((r) => setTimeout(r, 20))

    const entries = out.lines.map((line) => JSON.parse(line))
    assert.ok(entries.some((e) => e.msg === 'GET /api/posts/7 200 ' + e.ms + 'ms' || /GET \/api\/posts\/7 200/.test(e.msg)))
    assert.ok(entries.some((e) => e.msg === 'Slow request' && e.route === '/api/slow'))
    const text = registry.render()
    assert.match(text, /http_requests_total\{method="GET",route="\/api\/posts\/:id",status="200"\} 3/)
    assert.match(text, /route="not_found",status="404"/)
    assert.match(text, /http_request_duration_seconds_count\{method="GET",route="\/api\/posts\/:id"\} 3/)
    assert.match(text, /process_resident_memory_bytes \d+/)
  } finally {
    await app.close()
  }
})

test('server: errors are logged with the request id', async () => {
  const out = sink()
  const router = new Router()
  router.get('/api/fail', () => {
    throw new Error('kaput')
  })
  const app = await serve(router, { logger: createLogger({ format: 'json', stream: out, buffer: false }), accessLog: false })
  try {
    const res = await fetch(`${app.base}/api/fail`)
    assert.equal(res.status, 500)
    const entry = out.lines.map((line) => JSON.parse(line)).find((e) => e.level === 'error')
    assert.equal(entry.requestId, res.headers.get('x-request-id'))
    assert.equal(entry.error.message, 'kaput')
  } finally {
    await app.close()
  }
})

test('logger: buffered lines are written together on the next turn', async () => {
  const writes = []
  const log = createLogger({ format: 'json', stream: { write: (text) => writes.push(text) } })
  log.info('one')
  log.info('two')
  assert.equal(writes.length, 0)
  await new Promise((r) => setImmediate(r))
  assert.equal(writes.length, 1)
  assert.equal(writes[0].trim().split('\n').length, 2)
})

test('server: large JSON is compressed for clients that accept it, small JSON is not', async () => {
  const zlib = await import('node:zlib')
  const router = new Router()
  const big = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Post number ${i}` })) }
  router.get('/api/big', (req, res) => res.json(big))
  router.get('/api/small', (req, res) => res.json({ ok: true }))
  const app = await serve(router, { accessLog: false })
  const get = (path, encoding) =>
    new Promise((resolve, reject) => {
      http.get(`${app.base}${path}`, { headers: encoding ? { 'accept-encoding': encoding } : {} }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
  try {
    const br = await get('/api/big', 'gzip, deflate, br')
    assert.equal(br.headers['content-encoding'], 'br')
    assert.equal(br.headers.vary, 'Accept-Encoding')
    assert.equal(Number(br.headers['content-length']), br.body.length)
    assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body)), big)
    assert.ok(br.body.length < JSON.stringify(big).length / 3)
    const gz = await get('/api/big', 'gzip')
    assert.equal(gz.headers['content-encoding'], 'gzip')
    assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body)), big)
    const plain = await get('/api/big')
    assert.equal(plain.headers['content-encoding'], undefined)
    assert.deepEqual(JSON.parse(plain.body), big)
    const small = await get('/api/small', 'br')
    assert.equal(small.headers['content-encoding'], undefined)
  } finally {
    await app.close()
  }
})
