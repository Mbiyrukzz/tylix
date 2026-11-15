import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isFrontendChange, isPageRouteChange } from './dev.js'
import { watchDirectoryTree } from '../hotReload.js'
import { injectSsrErrorOverlay, keepSsrModulesFresh } from '../frontend/frontendHost.js'

const base = '/project'
const app = (...p) => path.join(base, 'app', ...p)

test('frontend files anywhere under app/ never restart the server', () => {
  for (const file of [
    app('pages', 'Home.tyx'),
    app('loading.tyx'),
    app('index.html'),
    app('tailwind-input.css'),
    app('useApi', 'posts.ts'),
    app('frontend', 'pages', 'Home.tsx'),
    app('views', 'pages', 'Home.tsx'),
  ]) {
    assert.equal(isFrontendChange(base, file), true, file)
  }
  for (const file of [app('controllers', 'PostController.ts'), app('models', 'Post.ts'), app('routes', 'api.ts'), app('mail', 'welcome.html')]) {
    assert.equal(isFrontendChange(base, file), false, file)
  }
})

test('only an added or removed page changes the routes', () => {
  const page = app('pages', 'About.tyx')
  assert.equal(isPageRouteChange(base, { file: page, kind: 'created' }), true)
  assert.equal(isPageRouteChange(base, { file: page, kind: 'removed' }), true)
  assert.equal(isPageRouteChange(base, { file: page, kind: 'saved' }), false)
  assert.equal(isPageRouteChange(base, { file: app('pages', 'posts', '[id].tyx'), kind: 'created' }), true)
  // Not routes: components, layouts, not-found pages, files outside pages/.
  assert.equal(isPageRouteChange(base, { file: app('pages', 'components', 'Card.tyx'), kind: 'created' }), false)
  assert.equal(isPageRouteChange(base, { file: app('pages', '_layout.tyx'), kind: 'created' }), false)
  assert.equal(isPageRouteChange(base, { file: app('pages', '_not-found.tyx'), kind: 'removed' }), false)
  assert.equal(isPageRouteChange(base, { file: app('loading.tyx'), kind: 'created' }), false)
})

test('the directory watcher reports what kind of change each file had', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-watch-'))
  const existing = path.join(dir, 'existing.tyx')
  fs.writeFileSync(existing, 'a')
  const batches = []
  const watcher = watchDirectoryTree(dir, (_last, _files, events) => batches.push(events), { debounceMs: 50, log: false })
  try {
    const wait = () => new Promise((r) => setTimeout(r, 300))
    const created = path.join(dir, 'new.tyx')
    fs.writeFileSync(created, 'b')
    await wait()
    fs.writeFileSync(existing, 'changed')
    await wait()
    fs.rmSync(created)
    await wait()
    const kinds = batches.flat().map((e) => `${path.basename(e.file)}:${e.kind}`)
    assert.deepEqual(kinds, ['new.tyx:created', 'existing.tyx:saved', 'new.tyx:removed'])
  } finally {
    watcher.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('any saved frontend file drops the whole SSR module graph', () => {
  const watcher = new EventEmitter()
  let invalidated = 0
  const server = { watcher, environments: { ssr: { moduleGraph: { invalidateAll: () => invalidated++ } } } }
  keepSsrModulesFresh(server)
  watcher.emit('change', '/project/app/views/pages/home.ts')
  watcher.emit('add', '/project/app/views/pages/new.ts')
  watcher.emit('unlink', '/project/app/views/pages/new.ts')
  assert.equal(invalidated, 3)
})

test('a failed server render opens the Vite error overlay, with the error escaped', () => {
  const html = injectSsrErrorOverlay('<html><body><div id="root"></div></body></html>', new Error('bad </script><img>'))
  assert.match(html, /import \{ ErrorOverlay \} from '\/@vite\/client'/)
  assert.ok(html.includes('Server rendering failed'))
  assert.ok(!html.includes('</script><img>'), 'the message cannot close the script tag')
  assert.ok(html.trimEnd().endsWith('</script></body></html>'))
})
