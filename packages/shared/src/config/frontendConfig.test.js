import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveFrontendConfig, FRONTEND_DRIVERS, defineConfig } from './frontendConfig.js'

test('no frontend section means native .tyx pages with defaults', () => {
  assert.deepEqual(resolveFrontendConfig(undefined), {
    driver: 'tylix',
    ssr: false,
    protected: [],
    loginPath: '/login',
    vite: {},
  })
})

test('a hosted frontend keeps its options', () => {
  const config = resolveFrontendConfig({ driver: 'react', ssr: true, protected: ['/dashboard/**'] })
  assert.equal(config.driver, 'react')
  assert.equal(config.ssr, true)
  assert.deepEqual(config.protected, ['/dashboard/**'])
  assert.equal(config.loginPath, '/login')
})

test('every driver is known', () => {
  for (const driver of FRONTEND_DRIVERS) assert.equal(resolveFrontendConfig({ driver }).driver, driver)
})

test('mistakes are reported by field name', () => {
  const cases = [
    [{ driver: 'reakt' }, /frontend\.driver "reakt" is unknown/],
    [{ driver: 'react', ssr: 'yes' }, /frontend\.ssr must be true or false/],
    [{ ssr: true }, /frontend\.ssr is for hosted frontends/],
    [{ protected: '/dashboard' }, /frontend\.protected must be a list/],
    [{ protected: ['dashboard'] }, /frontend\.protected must be a list/],
    [{ loginPath: 'login' }, /frontend\.loginPath must be a path/],
    [{ vite: [] }, /frontend\.vite must be an object/],
    [{ sssr: true }, /frontend\.sssr is not a frontend option/],
    ['react', /frontend must be an object/],
  ]
  for (const [input, error] of cases) assert.throws(() => resolveFrontendConfig(input), error, JSON.stringify(input))
})

test('defineConfig returns the config unchanged', () => {
  const config = { frontend: { driver: 'vue' } }
  assert.equal(defineConfig(config), config)
})
