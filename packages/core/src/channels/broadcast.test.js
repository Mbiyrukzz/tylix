import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, setStore } from '../store/index.js'
import { ChannelServer } from './ChannelServer.js'
import { broadcast } from './broadcast.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const fakeClient = (log) => ({ OPEN: 1, readyState: 1, send: (text) => log.push(JSON.parse(text)) })

test('broadcast() from app code reaches the clients of every connected channel server', async () => {
  const store = await createStore({ driver: 'memory' })
  setStore(store)
  const first = new ChannelServer().channel('chat', {})
  const second = new ChannelServer().channel('chat', {})
  await first.connectStore(store)
  await second.connectStore(store)
  const a = []
  const b = []
  first.channels.get('chat').clients.add(fakeClient(a))
  second.channels.get('chat').clients.add(fakeClient(b))

  await broadcast('chat', { text: 'from the API' })
  await wait(10)
  assert.deepEqual(a, [{ text: 'from the API' }])
  assert.deepEqual(b, [{ text: 'from the API' }])

  // A server's own broadcast reaches its clients once, and the other's too.
  first.broadcast('chat', { text: 'from a client' })
  await wait(10)
  assert.deepEqual(a.at(-1), { text: 'from a client' })
  assert.equal(a.filter((m) => m.text === 'from a client').length, 1)
  assert.deepEqual(b.at(-1), { text: 'from a client' })
})
