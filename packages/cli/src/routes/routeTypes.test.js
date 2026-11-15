import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { generateRouteClient, nameRoutes } from './routeTypes.js'
import { createRouteClient, buildPath } from '../../../client/src/routeClient.js'

const r = (method, pattern, extra = {}) => ({ method, pattern, auth: false, source: 'routes', ...extra })

test('nameRoutes: resource names, single routes as functions, no clashes', () => {
  const named = nameRoutes([
    r('GET', '/api/posts'),
    r('POST', '/api/posts'),
    r('GET', '/api/posts/:id'),
    r('PUT', '/api/posts/:id'),
    r('PATCH', '/api/posts/:id'),
    r('DELETE', '/api/posts/:id'),
    r('POST', '/api/login'),
    r('GET', '/api/me'),
    r('POST', '/api/auth/refresh'),
    r('GET', '/api/auth/sessions'),
    r('DELETE', '/api/auth/sessions/:id'),
    r('GET', '/api/posts/:postId/comments'),
    r('POST', '/api/contact-form'),
  ]).map((x) => `${x.method} ${x.pattern} ${x.name}`)
  assert.deepEqual(named, [
    'GET /api/posts posts.index',
    'POST /api/posts posts.store',
    'GET /api/posts/:id posts.show',
    'PUT /api/posts/:id posts.update',
    'PATCH /api/posts/:id posts.updatePatchById',
    'DELETE /api/posts/:id posts.destroy',
    'POST /api/login login',
    'GET /api/me me',
    'POST /api/auth/refresh auth.refresh',
    'GET /api/auth/sessions auth.sessions.index',
    'DELETE /api/auth/sessions/:id auth.sessions.destroy',
    'GET /api/posts/:postId/comments posts.comments',
    'POST /api/contact-form contactForm',
  ])
})

const features = [
  {
    manifest: {
      name: 'Post',
      model: 'Post',
      table: 'posts',
      fields: [
        { name: 'title', type: 'string' },
        { name: 'views', type: 'integer' },
        { name: 'user_id', type: 'integer', system: true },
      ],
    },
  },
]
const routes = [
  r('GET', '/api/posts', { source: 'feature', auth: true }),
  r('POST', '/api/posts', { source: 'feature', auth: true }),
  r('GET', '/api/posts/:id', { source: 'feature', auth: true }),
  r('PUT', '/api/posts/:id', { source: 'feature', auth: true }),
  r('DELETE', '/api/posts/:id', { source: 'feature', auth: true }),
  r('POST', '/api/login', { source: 'auth' }),
  r('GET', '/api/me', { source: 'auth', auth: true }),
  r('GET', '/api/_tylix/features'),
  r('GET', '/health'),
  r('POST', '/api/contact'),
]

test('generateRouteClient: models from features, auth bodies, skips dev routes', () => {
  const { ts, js, dts } = generateRouteClient({ routes, features })
  assert.match(ts, /export interface Post \{\n  id: number\n  title: string \| null\n  views: number \| null\n  user_id: number \| null/)
  assert.match(ts, /export interface PostInput \{\n  title\?: string \| null\n  views\?: number \| null\n\}/)
  assert.match(ts, /"GET \/api\/posts": \{\n    params: Record<string, never>\n    query: \{ page\?: number/)
  assert.match(ts, /response: Paginated<Post>/)
  assert.match(ts, /"POST \/api\/login": \{[^}]*body: \{ email: string; password: string; remember\?: boolean \}/)
  assert.match(ts, /show\(params: ApiRoutes\["GET \/api\/posts\/:id"\]\['params'\], options\?/)
  assert.match(ts, /contact\(body\?: /)
  assert.doesNotMatch(ts, /_tylix|\/health/)
  assert.match(js, /export const routes = createRouteClient\(api, \{\n  contact: \["POST", "\/api\/contact"\],/)
  assert.match(dts, /export declare const routes: RouteClient/)
})

test('the generated TypeScript compiles and is strict about params and bodies', (t) => {
  const tsc = path.resolve(import.meta.dirname, '../../../../node_modules/.bin/tsc')
  if (!fs.existsSync(tsc)) return t.skip('typescript is not installed')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-routes-'))
  const client = path.resolve(import.meta.dirname, '../../../client/src/index.d.ts')
  fs.writeFileSync(path.join(dir, 'api.generated.ts'), generateRouteClient({ routes, features }).ts.replaceAll("'@tylix/client'", JSON.stringify(client.replace(/\.d\.ts$/, '.js'))))
  fs.writeFileSync(
    path.join(dir, 'use.ts'),
    `import { routes } from './api.generated'
async function main() {
  const list = await routes.posts.index({ query: { page: 2 } })
  if (list.ok) list.data.data[0].title?.toUpperCase()
  const one = await routes.posts.show({ id: 7 })
  if (one.ok) one.data.data.id.toFixed()
  await routes.posts.update({ id: 7 }, { title: 'x' })
  await routes.login({ email: 'a@b.c', password: 'p' })
  await routes.$request('DELETE /api/posts/:id', { params: { id: 1 } })
  // @ts-expect-error id is required
  await routes.posts.show({})
  // @ts-expect-error title is a string
  await routes.posts.store({ title: 5 })
}
main()
`,
  )
  execFileSync(tsc, ['--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--allowJs', 'use.ts'], { cwd: dir, stdio: 'pipe' })
})

test('createRouteClient: params, body, query and $request', async () => {
  const calls = []
  const api = async (url, options) => (calls.push([url, options.method, options.body]), { ok: true })
  const client = createRouteClient(api, {
    posts: { show: ['GET', '/api/posts/:id'], update: ['PUT', '/api/posts/:id'], index: ['GET', '/api/posts'] },
    login: ['POST', '/api/login'],
  })
  await client.posts.show({ id: 'a b' }, { query: { include: 'author', tags: ['x', 'y'], skip: undefined } })
  await client.posts.update({ id: 3 }, { title: 'T' })
  await client.posts.index({ query: { page: 2 } })
  await client.login({ email: 'e' })
  await client.$request('DELETE /api/posts/:id', { params: { id: 9 } })
  assert.deepEqual(calls, [
    ['/api/posts/a%20b?include=author&tags=x&tags=y', 'GET', undefined],
    ['/api/posts/3', 'PUT', { title: 'T' }],
    ['/api/posts?page=2', 'GET', undefined],
    ['/api/login', 'POST', { email: 'e' }],
    ['/api/posts/9', 'DELETE', undefined],
  ])
  assert.throws(() => buildPath('/api/posts/:id', {}), /needs "id"/)
})
