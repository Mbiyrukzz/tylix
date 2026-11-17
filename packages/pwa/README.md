# @tylix/pwa

Make any web app an installable **progressive web app** that keeps working
offline: the web manifest, a generated service worker with safe caching,
update and install prompts, and helpers for React, Vue, Svelte and
Angular. No dependencies.

```sh
npm install @tylix/pwa
```

## In a Tylix app

```sh
tylix make:pwa
```

That adds `pwa` to `tylix.config`, icons and an offline page to
`public/`, and an install/update prompt (a `.tyx` component and `Pwa`
capability, or a React, Vue, Svelte or Angular component). Tylix then
serves `/manifest.webmanifest` and `/sw.js` and puts the tags in every
page. It works the same for `.tyx` pages and for React, Vue, Svelte and
Angular, server-rendered or not.

```js
// tylix.config
pwa: {
  name: 'Acme',
  shortName: 'Acme',
  themeColor: '#0034CA',
  backgroundColor: '#ffffff',
  // optional:
  pages: 'network-only',            // or 'network-first' (see Caching)
  exclude: [/^\/admin\//],          // paths the worker never touches
  runtimeCaching: [{ match: /^\/uploads\//, strategy: 'cache-first', maxEntries: 60 }],
  shortcuts: [{ name: 'New post', url: '/dashboard?new=1' }],
  dev: false,                       // register in development too
}
```

`pwa: true` uses every default (the name comes from `app.name`).

The worker only runs in production (`tylix build`, `tylix start`). In
development `/sw.js` is a worker that removes itself and its caches, so a
production run on the same port never serves you stale files.

Each deploy whose files changed is a new version: open pages get "A new
version is ready" and switch when the user clicks Reload.

## Caching

| Request | Strategy |
| --- | --- |
| Precached files (`public/` top level, the built `/assets/` bundle) | cache first, refreshed per version |
| Page navigations | network only, the offline page when offline (default) |
| Other scripts, styles, fonts, images | stale-while-revalidate |
| `/api/`, `/_tylix/`, dev tools, `/sw.js`, the manifest | never touched |
| Your `runtimeCaching` rules | as configured |

Pages are not cached by default on purpose: a page can hold the signed-in
user's data (server-rendered sessions do), and a cached copy would be
shown to the next person on that device. `pages: 'network-first'` caches
them anyway, for public sites.

Offline visitors get `public/offline.html` (what `make:pwa` writes), or a
built-in page in your theme colour.

## In the browser

```js
import { pwa } from '@tylix/pwa/client'

const app = pwa()             // the shared instance (Tylix already started it)
app.subscribe((s) => {
  s.installable      // the browser offers installation
  s.updateAvailable  // a new version is waiting
  s.offlineReady     // first install done
  s.online
  s.installed        // running as an installed app
})
await app.install()  // 'accepted' | 'dismissed' | 'unavailable'
app.update()         // switch to the new version and reload
```

| | |
| --- | --- |
| React | `const { installable, updateAvailable, install, update } = usePwa()` from `@tylix/pwa/react` |
| Vue | `const { state, install, update } = usePwa()` from `@tylix/pwa/vue` |
| Svelte | `import { pwa } from '@tylix/pwa/svelte'` then `$pwa.updateAvailable`, `pwa.update()` |
| Angular | `pwa = injectPwa()` from `@tylix/pwa/angular` then `pwa.state().updateAvailable` |
| `.tyx` pages | the `Pwa` capability: `Pwa.installable`, `Pwa.install()`, `Pwa.update()` |

On the server (SSR) these return an inert state, so pages render the same
there and in the browser.

## Without Tylix

```js
import { manifest, serviceWorker, headTags } from '@tylix/pwa'

const options = { name: 'Acme', themeColor: '#0034CA', version: process.env.BUILD_ID, precache: ['/app.css', '/app.js'] }

app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(manifest(options))))
app.get('/sw.js', (req, res) => res.type('text/javascript').set('Cache-Control', 'no-cache').send(serviceWorker(options)))
// and headTags(options) inside <head> of every page
```

`offlinePage(options)` returns the built-in offline page and
`devServiceWorker()` the self-removing worker.

## Icons

Browsers offer installation once the manifest has a 192px and a 512px
PNG icon. `make:pwa` copies the Tylix mark (`pwa-192.png`, `pwa-512.png`,
`pwa-maskable-512.png`, `apple-touch-icon.png`): replace them with your
own. A maskable icon keeps its artwork inside the middle 80%.

## License

MIT
