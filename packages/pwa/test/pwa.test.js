import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { manifest, serviceWorker, devServiceWorker, headTags, offlinePage, resolveOptions, DEFAULT_EXCLUDE } from '../src/index.js'
import { installPwaRuntime } from '../src/runtime.js'
import { pwa } from '../src/client.js'

test('manifest has the install essentials and merges extras last', () => {
  const m = manifest({ name: 'Acme Dashboard', themeColor: '#123456', manifest: { display_override: ['window-controls-overlay'] } })
  assert.equal(m.name, 'Acme Dashboard')
  assert.equal(m.short_name, 'Acme')
  assert.equal(m.start_url, '/')
  assert.equal(m.display, 'standalone')
  assert.equal(m.theme_color, '#123456')
  assert.equal(m.icons.length, 3)
  assert.deepEqual(m.display_override, ['window-controls-overlay'])
  assert.equal('description' in m, false)
})

test('resolving twice changes nothing', () => {
  const once = resolveOptions({ exclude: ['^/admin/'] })
  assert.equal(resolveOptions(once), once)
  assert.equal(once.exclude.length, DEFAULT_EXCLUDE.length + 1)
})

test('the worker is valid JavaScript and carries its config', () => {
  const source = serviceWorker({ version: 'abc', precache: ['/app.css', '/app.css'], exclude: [/^\/admin\//], runtimeCaching: [{ match: /^\/images\//, strategy: 'cache-first', maxEntries: 10 }] })
  new vm.Script(source)
  const config = JSON.parse(/const CONFIG = (\{[\s\S]*?\});\n/.exec(source)[1])
  assert.equal(config.version, 'abc')
  assert.deepEqual(config.precache, ['/app.css'])
  assert.ok(config.exclude.includes('^/api/'))
  assert.ok(config.exclude.includes('^\\/admin\\/'))
  assert.equal(config.runtime[0].match, '^\\/images\\/')
  assert.equal(config.pages, 'network-only')
  new vm.Script(devServiceWorker())
})

test('without an offline page the worker carries the built-in one', () => {
  const config = JSON.parse(/const CONFIG = (\{[\s\S]*?\});\n/.exec(serviceWorker({ offline: null, name: 'Acme' }))[1])
  assert.equal(config.offline, null)
  assert.match(config.builtinOffline, /Acme can’t reach the network/)
})

test('head tags escape the name and colour', () => {
  const head = headTags({ name: 'A "quoted" <app>', themeColor: '#fff"' })
  assert.match(head, /<link rel="manifest" href="\/manifest.webmanifest">/)
  assert.match(head, /content="#fff&quot;"/)
  assert.doesNotMatch(head, /<app>/)
  assert.match(head, /<script>\(function installPwaRuntime/)
  assert.match(offlinePage({ name: '<b>' }), /&lt;b>/)
})

// A small fake browser: events, a service worker container and a
// registration whose worker can be driven through its states.
function fakeWindow({ controlled = false } = {}) {
  const target = new EventTarget()
  const worker = () => {
    const w = new EventTarget()
    w.state = 'installing'
    w.messages = []
    w.postMessage = (m) => w.messages.push(m)
    w.to = (state) => {
      w.state = state
      w.dispatchEvent(new Event('statechange'))
    }
    return w
  }
  const registration = new EventTarget()
  registration.installing = worker()
  registration.waiting = null
  registration.update = async () => {}
  registration.unregister = async () => true
  const container = new EventTarget()
  container.controller = controlled ? {} : null
  container.register = async () => registration
  const win = Object.assign(target, {
    navigator: { serviceWorker: container, onLine: true },
    document: { readyState: 'complete' },
    location: { reloaded: 0, reload() { this.reloaded++ } },
    matchMedia: () => ({ matches: false }),
    CustomEvent: class extends Event {
      constructor(type, init) {
        super(type)
        this.detail = init?.detail
      }
    },
  })
  return { win, registration, container }
}

test('runtime: first install reports offline-ready', async () => {
  const { win, registration } = fakeWindow()
  const app = installPwaRuntime(win, { checkEvery: 0 })
  const seen = []
  app.subscribe((s) => seen.push(s))
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(app.state.registered, true)
  registration.installing.to('installed')
  assert.equal(app.state.offlineReady, true)
  assert.equal(app.state.updateAvailable, false)
  assert.ok(seen.length >= 3)
  assert.equal(installPwaRuntime(win), app) // one instance per window
})

test('runtime: an update waits for the user, then reloads once', async () => {
  const { win, registration, container } = fakeWindow({ controlled: true })
  const app = installPwaRuntime(win, { checkEvery: 0 })
  await new Promise((r) => setTimeout(r, 0))
  const next = registration.installing
  next.to('installed')
  registration.waiting = next
  assert.equal(app.state.updateAvailable, true)
  container.dispatchEvent(new Event('controllerchange')) // not asked for: no reload
  assert.equal(win.location.reloaded, 0)
  assert.equal(app.update(), true)
  assert.deepEqual(next.messages, [{ type: 'SKIP_WAITING' }])
  container.dispatchEvent(new Event('controllerchange'))
  container.dispatchEvent(new Event('controllerchange'))
  assert.equal(win.location.reloaded, 1)
})

test('runtime: the install prompt is kept until asked for', async () => {
  const { win } = fakeWindow()
  const app = installPwaRuntime(win, { register: false })
  assert.equal(await app.install(), 'unavailable')
  const prompt = new Event('beforeinstallprompt', { cancelable: true })
  let shown = 0
  prompt.prompt = () => shown++
  prompt.userChoice = Promise.resolve({ outcome: 'accepted' })
  win.dispatchEvent(prompt)
  assert.equal(prompt.defaultPrevented, true)
  assert.equal(app.state.installable, true)
  assert.equal(await app.install(), 'accepted')
  assert.equal(shown, 1)
  assert.equal(app.state.installable, false)
  win.dispatchEvent(new Event('offline'))
  assert.equal(app.state.online, false)
})

test('the runtime survives toString(), as the server inlines it', () => {
  const { win } = fakeWindow()
  const rebuilt = new Function(`return (${installPwaRuntime.toString()})`)()
  const app = rebuilt(win, { register: false })
  assert.equal(typeof app.subscribe, 'function')
})

test('client: an inert instance without a window', async () => {
  const instance = pwa()
  assert.equal(instance.state.supported, false)
  assert.equal(await instance.install(), 'unavailable')
  let calls = 0
  instance.subscribe(() => calls++)()
  assert.equal(calls, 1)
})
