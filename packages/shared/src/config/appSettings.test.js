import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAppSettings } from './appSettings.js'

const VARS = ['APP_ENV', 'APP_NAME', 'APP_DEBUG', 'APP_URL', 'PORT', 'AUTO_PORT', 'PORT_ATTEMPTS', 'TRUST_PROXY', 'TRUSTED_ORIGINS', 'MAX_BODY_BYTES', 'CSP_MODE', 'CSP_POLICY', 'CHANNELS_PORT']
const savedNodeEnv = process.env.NODE_ENV
beforeEach(() => {
  for (const name of VARS) delete process.env[name]
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedNodeEnv
})

test('defaults, with sources', () => {
  delete process.env.NODE_ENV
  const sources = {}
  const { app, server, channels } = resolveAppSettings({}, sources)
  assert.equal(app.env, 'development')
  assert.equal(app.production, false)
  assert.equal(server.port, 3000)
  assert.equal(server.autoPort, true)
  assert.equal(server.csp.mode, 'off')
  assert.equal(server.csp.policy, undefined)
  assert.deepEqual(server.trustedOrigins, [])
  assert.equal(channels.port, 6001)
  assert.equal(sources['server.port'].from, 'default')
})

test('env beats tylix.config beats defaults; production changes defaults', () => {
  process.env.PORT = '8080'
  process.env.TRUSTED_ORIGINS = 'https://a.example, https://b.example'
  process.env.APP_ENV = 'production'
  const sources = {}
  const { app, server } = resolveAppSettings({ server: { port: 4000, maxBodyBytes: 2048 }, app: { name: 'Shop' } }, sources)
  assert.equal(server.port, 8080)
  assert.equal(sources['server.port'].env, 'PORT')
  assert.equal(server.maxBodyBytes, 2048)
  assert.equal(sources['server.maxBodyBytes'].from, 'tylix.config')
  assert.equal(app.name, 'Shop')
  assert.equal(app.production, true)
  assert.equal(server.autoPort, false)
  assert.equal(server.csp.mode, 'report-only')
  assert.deepEqual(server.trustedOrigins, ['https://a.example', 'https://b.example'])
})

test('bad values stop with the variable name', () => {
  process.env.PORT = 'abc'
  assert.throws(() => resolveAppSettings(), /PORT must be a port number \(1-65535\), got "abc"/)
  delete process.env.PORT
  process.env.CSP_MODE = 'strict'
  assert.throws(() => resolveAppSettings(), /CSP_MODE must be off, report-only, enforce/)
  delete process.env.CSP_MODE
  process.env.APP_DEBUG = 'maybe'
  assert.throws(() => resolveAppSettings(), /APP_DEBUG must be true or false/)
  delete process.env.APP_DEBUG
  process.env.APP_URL = 'example.com'
  assert.throws(() => resolveAppSettings(), /APP_URL must be a full URL/)
  delete process.env.APP_URL
  assert.throws(() => resolveAppSettings({ server: { port: 70000 } }), /tylix.config server.port must be a port number/)
})

test('booleans accept the usual spellings; APP_URL loses its trailing slash', () => {
  process.env.AUTO_PORT = 'no'
  process.env.TRUST_PROXY = '1'
  process.env.APP_URL = 'https://shop.example/'
  const { app, server } = resolveAppSettings()
  assert.equal(server.autoPort, false)
  assert.equal(server.trustProxy, true)
  assert.equal(app.url, 'https://shop.example')
})
