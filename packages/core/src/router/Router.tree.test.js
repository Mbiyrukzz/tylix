import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from './Router.js'

const run = async (router, method, url) => {
  const match = router.match(method, url)
  if (!match) return null
  const out = []
  await match.handler({ params: match.params }, { send: (value) => out.push(value) })
  return { params: match.params, sent: out }
}
const answer = (value) => (req, res) => res.send(value)

test('exact paths, parameters, and no match', async () => {
  const router = new Router()
  router.get('/health', answer('health'))
  router.get('/users/:id', answer('user'))
  router.get('/users/:id/posts/:postId', answer('post'))
  assert.deepEqual((await run(router, 'GET', '/health?x=1')).sent, ['health'])
  assert.deepEqual(await run(router, 'GET', '/users/42'), { params: { id: '42' }, sent: ['user'] })
  assert.deepEqual((await run(router, 'GET', '/users/7/posts/9')).params, { id: '7', postId: '9' })
  assert.equal(router.match('GET', '/users/'), null, 'a parameter needs a value')
  assert.equal(router.match('GET', '/users/42/'), null, 'trailing slash is a different path')
  assert.equal(router.match('POST', '/users/42'), null, 'other methods do not match')
  assert.equal(router.match('GET', '/nope'), null)
})

test('the earliest registered route wins, whatever its shape', async () => {
  const paramFirst = new Router()
  paramFirst.get('/users/:id', answer('param'))
  paramFirst.get('/users/me', answer('static'))
  assert.deepEqual((await run(paramFirst, 'GET', '/users/me')).sent, ['param'])

  const staticFirst = new Router()
  staticFirst.get('/users/me', answer('static'))
  staticFirst.get('/users/:id', answer('param'))
  assert.deepEqual((await run(staticFirst, 'GET', '/users/me')).sent, ['static'])
  assert.deepEqual((await run(staticFirst, 'GET', '/users/5')).sent, ['param'])

  const deep = new Router()
  deep.get('/a/:x/c', answer('first'))
  deep.get('/a/b/:y', answer('second'))
  assert.deepEqual((await run(deep, 'GET', '/a/b/c')).sent, ['first'])

  const dupes = new Router()
  dupes.get('/same', answer('one'))
  dupes.get('/same', answer('two'))
  assert.deepEqual((await run(dupes, 'GET', '/same')).sent, ['one'])
})

test('parameters are URL-decoded; a bad escape throws URIError (a 400)', async () => {
  const router = new Router()
  router.get('/files/:name', answer('file'))
  assert.deepEqual((await run(router, 'GET', '/files/a%20b.txt')).params, { name: 'a b.txt' })
  assert.throws(() => router.match('GET', '/files/%E0%A4%A'), URIError)
})

test('static text is literal: dots are not wildcards', () => {
  const router = new Router()
  router.get('/sitemap.xml', answer('xml'))
  assert.ok(router.match('GET', '/sitemap.xml'))
  assert.equal(router.match('GET', '/sitemapXxml'), null)
})

test('middleware runs in order and use() after routes still applies', async () => {
  const router = new Router()
  const order = []
  router.get('/x', (req, res, next) => (order.push('route-mw'), next()), (req, res) => order.push('handler'))
  await run(router, 'GET', '/x')
  router.use((req, res, next) => (order.push('global'), next()))
  order.length = 0
  await run(router, 'GET', '/x')
  assert.deepEqual(order, ['global', 'route-mw', 'handler'])
})

test('a middleware that stops the chain, and next() twice is an error', async () => {
  const router = new Router()
  router.get('/stop', (req, res) => res.send('stopped'), answer('never'))
  assert.deepEqual((await run(router, 'GET', '/stop')).sent, ['stopped'])
  router.get('/twice', async (req, res, next) => {
    await next()
    await next()
  }, answer('x'))
  await assert.rejects(run(router, 'GET', '/twice'), /next\(\) called multiple times/)
})

test('lookup cost does not grow with the number of routes', () => {
  const router = new Router()
  for (let i = 0; i < 5000; i++) router.get(`/api/r${i}/:id/items`, answer(i))
  router.get('/users/:id', answer('user'))
  const start = performance.now()
  for (let i = 0; i < 20000; i++) router.match('GET', '/users/42')
  const perLookupMs = (performance.now() - start) / 20000
  assert.ok(perLookupMs < 0.05, `lookup took ${perLookupMs}ms with 5000 routes`)
})
