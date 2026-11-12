import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compile } from 'svelte/compiler'
import { renderWithData } from './server.js'

// Server rendering only: hydration needs Svelte's browser build, which
// conflicts with the server build in one Node process. The e2e parity
// suite covers hydration in a real browser.

const here = path.dirname(fileURLToPath(import.meta.url))
const tmp = path.join(here, '.tmp-ssr-test')

const SOURCES = {
  Page: `<script>
  import { useApi, useSession } from '@tylix/svelte'
  import Comments from './Comments.svelte'
  const session = useSession()
  const posts = useApi('/api/posts')
</script>
<h1>{$session.user ? 'Hi ' + $session.user.name : 'Hi guest'}</h1>
{#if $posts.loading}<p>loading</p>{:else}{#each $posts.data as p (p.id)}<section>{p.title} <Comments postId={p.id} /></section>{/each}{/if}`,
  Comments: `<script>
  import { useApi } from '@tylix/svelte'
  let { postId } = $props()
  const comments = useApi('/api/posts/' + postId + '/comments')
</script>
<em>{$comments.loading ? '…' : $comments.data.join(',')}</em>`,
  Where: `<script>
  import { useRoute } from '@tylix/svelte'
  const route = useRoute()
</script>
<p>{$route.path} {$route.query.get('tab')}</p>`,
  NotFound: `<script>
  import { useServerContext } from '@tylix/svelte'
  const server = useServerContext()
  if (server) server.status = 404
</script>
<h1>Page not found</h1>`,
  GoAway: `<script>
  import { useServerContext } from '@tylix/svelte'
  const server = useServerContext()
  if (server) server.redirect = '/login'
</script>`,
}

const components = {}
before(async () => {
  await fs.mkdir(tmp, { recursive: true })
  for (const [name, source] of Object.entries(SOURCES)) {
    const { js } = compile(source, { generate: 'server', filename: `${name}.svelte` })
    // Imports of other components point at their compiled .js files.
    await fs.writeFile(path.join(tmp, `${name}.js`), js.code.replaceAll('.svelte', '.js'))
  }
  for (const name of Object.keys(SOURCES)) {
    components[name] = (await import(pathToFileURL(path.join(tmp, `${name}.js`)).href)).default
  }
})
after(() => fs.rm(tmp, { recursive: true, force: true }))

async function load(url) {
  if (url === '/api/posts') return { status: 200, data: [{ id: 1, title: 'First' }] }
  if (url === '/api/posts/1/comments') return { status: 200, data: ['Nice'] }
  return { status: 404, data: { error: 'Not found' } }
}

const text = (html) => html.replace(/<!--[^>]*-->/g, '')

test('loads data across passes and renders it, as the session user', async () => {
  const out = await renderWithData(components.Page, { url: '/', session: { user: { id: 1, name: 'Ada' } }, load })
  assert.equal(text(out.html), '<h1>Hi Ada</h1> <section>First <em>Nice</em></section>')
  assert.equal(out.status, 200)
  assert.deepEqual(Object.keys(out.data), ['/api/posts', '/api/posts/1/comments'])
  assert.equal(out.data['/api/posts'].ok, true)
})

test('a guest renders guest UI', async () => {
  const out = await renderWithData(components.Page, { session: { user: null }, load })
  assert.match(out.html, /Hi guest/)
})

test('useRoute gives the request location, not the server process', async () => {
  const out = await renderWithData(components.Where, { url: '/dashboard?tab=posts', load })
  assert.equal(text(out.html), '<p>/dashboard posts</p>')
})

test('components set the status or redirect through useServerContext', async () => {
  assert.equal((await renderWithData(components.NotFound, { load })).status, 404)
  assert.equal((await renderWithData(components.GoAway, { load })).redirect, '/login')
})

test('requests are kept apart: concurrent renders see their own session', async () => {
  const [a, b] = await Promise.all([
    renderWithData(components.Page, { session: { user: { id: 1, name: 'Ada' } }, load }),
    renderWithData(components.Page, { session: { user: { id: 2, name: 'Grace' } }, load }),
  ])
  assert.match(a.html, /Hi Ada/)
  assert.match(b.html, /Hi Grace/)
})
