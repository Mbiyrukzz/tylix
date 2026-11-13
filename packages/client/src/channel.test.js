import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'
import { channel } from './channel.js'

// A real WebSocket server (the "ws" package the channel server uses) and
// Node's built-in WebSocket client, which matches the browser's.
function startServer() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => resolve(wss))
  })
}

const waitFor = async (check, timeoutMs = 4000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

test('connects to /<name>, sends queued messages on open, and receives JSON', async () => {
  const wss = await startServer()
  const paths = []
  const received = []
  wss.on('connection', (ws, req) => {
    paths.push(req.url)
    ws.on('message', (raw) => {
      received.push(JSON.parse(raw.toString()))
      ws.send(JSON.stringify({ echo: JSON.parse(raw.toString()).text }))
      ws.send('not json') // ignored by the client
    })
  })

  const chat = channel('chat', { port: wss.address().port })
  const messages = []
  chat.onMessage((data) => messages.push(data))
  chat.send({ text: 'sent before open' }) // queued
  await waitFor(() => messages.length === 1)

  assert.deepEqual(paths, ['/chat'])
  assert.deepEqual(received, [{ text: 'sent before open' }])
  assert.deepEqual(messages, [{ echo: 'sent before open' }])
  assert.equal(chat.status, 'open')
  chat.close()
  await waitFor(() => chat.status === 'closed')
  wss.close()
})

test('reconnects after the server drops the connection; close() stops that', async () => {
  const wss = await startServer()
  let connections = 0
  wss.on('connection', (ws) => {
    connections++
    if (connections === 1) ws.close() // drop the first connection
  })

  const live = channel('news', { port: wss.address().port })
  const statuses = []
  live.onStatus((s) => statuses.push(s))
  await waitFor(() => connections === 2 && live.status === 'open')
  assert.ok(statuses.includes('reconnecting'))

  live.close()
  await waitFor(() => live.status === 'closed')
  await new Promise((r) => setTimeout(r, 700))
  assert.equal(connections, 2, 'no reconnect after close()')
  wss.close()
})

test('without a WebSocket (server rendering) it is inert', () => {
  const inert = channel('chat', { WebSocket: undefined })
  assert.equal(inert.status, 'closed')
  inert.send({ a: 1 })
  assert.equal(typeof inert.onMessage(() => {}), 'function')
  inert.close()
})

test('needs a name', () => {
  assert.throws(() => channel(''), /needs a channel name/)
})

test('lazyChannel queues sends until open() and reports status', async () => {
  const { lazyChannel } = await import('./channel.js')
  const wss = await startServer()
  const received = []
  wss.on('connection', (ws) => ws.on('message', (raw) => {
    received.push(JSON.parse(raw.toString()))
    ws.send(JSON.stringify({ ok: true }))
  }))
  globalThis.__TYLIX_CHANNELS_PORT__ = wss.address().port
  try {
    const statuses = []
    const messages = []
    const live = lazyChannel('room', { onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s) })
    live.send({ early: true })
    assert.deepEqual(statuses, [], 'nothing happens before open()')
    live.open()
    await waitFor(() => messages.length === 1)
    assert.deepEqual(received, [{ early: true }])
    assert.ok(statuses.includes('open'))
    live.close()
    await waitFor(() => statuses.at(-1) === 'closed')
  } finally {
    delete globalThis.__TYLIX_CHANNELS_PORT__
    wss.close()
  }
})
