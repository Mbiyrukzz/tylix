import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router, logger } from '@tylix/core'
import { ConnectionManager, SqliteAdapter } from '@tylix/orm'
import { createRequester } from '../testing.js'
import { configureObservability, registerOperationsRoutes } from './observability.js'

const settings = (overrides = {}) => ({
  observability: {
    logLevel: 'info', logFormat: 'json', accessLog: false, slowRequestMs: 0, slowQueryMs: 0, metrics: false, metricsToken: undefined,
    ...overrides,
  },
})

async function withDatabase(fn) {
  const adapter = await new SqliteAdapter({ filename: ':memory:' }).connect()
  ConnectionManager.setAdapter(adapter)
  try {
    return await fn(adapter)
  } finally {
    await adapter.close()
  }
}

test('slow queries are logged with their SQL; fast ones are not', async () => {
  const lines = []
  await withDatabase(async (db) => {
    configureObservability(settings({ slowQueryMs: 1 }))
    logger.configure({ stream: { write: (text) => lines.push(text) }, buffer: false })
    await db.get('SELECT 1')
    await db.get("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200000) SELECT count(*) FROM n")
  })
  configureObservability(settings())
  logger.configure({ stream: process.stdout, errorStream: process.stderr, buffer: true })
  const slow = lines.map((line) => JSON.parse(line)).filter((e) => e.msg === 'Slow query')
  assert.equal(slow.length, 1)
  assert.match(slow[0].sql, /WITH RECURSIVE/)
  assert.equal(slow[0].driver, 'sqlite')
})

test('/health, /ready (503 when the database is down) and guarded /metrics', async () => {
  await withDatabase(async (db) => {
    const router = new Router()
    registerOperationsRoutes(router, settings({ metrics: true, metricsToken: 's3cret' }))
    const request = createRequester({ router })
    assert.equal((await request('GET', '/health')).status, 200)
    const ready = await request('GET', '/ready')
    assert.equal(ready.status, 200)
    assert.equal(ready.data.checks.database.ok, true)
    assert.equal((await request('GET', '/metrics')).status, 403)
    const scraped = await request('GET', '/metrics', { headers: { authorization: 'Bearer s3cret' } })
    assert.equal(scraped.status, 200)
    await db.close()
    const down = await request('GET', '/ready')
    assert.equal(down.status, 503)
    assert.equal(down.data.checks.database.ok, false)
  })
})
