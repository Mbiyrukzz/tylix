import { test } from 'node:test'
import assert from 'node:assert/strict'

test('the package entry point loads and exports the public API', async () => {
  const core = await import('./index.js')
  for (const name of ['Router', 'Server', 'logger', 'metrics', 'currentRequest', 'dispatch', 'cache', 'ChannelServer']) {
    assert.ok(core[name], name)
  }
})
