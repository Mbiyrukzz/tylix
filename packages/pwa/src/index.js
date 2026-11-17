// @tylix/pwa: make any web app installable and usable offline.
//
// The server side, framework-agnostic: build the web manifest, the service
// worker and the <head> tags from one options object, then serve them from
// whatever server you use. Tylix does all of it for you (pwa in
// tylix.config); elsewhere:
//
//   import { manifest, serviceWorker, headTags } from '@tylix/pwa'
//   const options = { name: 'Acme', themeColor: '#0034CA', precache: ['/app.css', '/app.js'] }
//   app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(manifest(options))))
//   app.get('/sw.js', (req, res) => res.type('text/javascript').set('Cache-Control', 'no-cache').send(serviceWorker(options)))
//   // and headTags(options) inside <head> of every page
import { installPwaRuntime } from './runtime.js'

export { installPwaRuntime }

export const DEFAULT_EXCLUDE = Object.freeze([
  '^/api/',
  '^/_tylix/',
  '^/@',
  '^/__',
  '^/node_modules/',
  '^/sw\\.js$',
  '^/manifest\\.webmanifest$',
])

const DEFAULT_ICONS = Object.freeze([
  { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
])

const RESOLVED = Symbol.for('tylix.pwa.resolved')

// Fills in defaults. Accepts true (all defaults) or an options object.
// Resolving twice is harmless.
export function resolveOptions(input = {}) {
  if (input && input[RESOLVED]) return input
  const o = input === true || !input ? {} : input
  const name = o.name ?? 'Tylix app'
  return {
    name,
    shortName: o.shortName ?? (name.length > 12 ? name.split(/\s+/)[0].slice(0, 12) : name),
    description: o.description ?? '',
    lang: o.lang ?? 'en',
    startUrl: o.startUrl ?? '/',
    scope: o.scope ?? '/',
    display: o.display ?? 'standalone',
    orientation: o.orientation,
    themeColor: o.themeColor ?? '#0034CA',
    backgroundColor: o.backgroundColor ?? '#ffffff',
    icons: o.icons ?? DEFAULT_ICONS,
    appleTouchIcon: o.appleTouchIcon ?? '/apple-touch-icon.png',
    shortcuts: o.shortcuts,
    screenshots: o.screenshots,
    categories: o.categories,
    // Extra manifest fields, merged last.
    manifest: o.manifest ?? {},

    // Service worker
    swUrl: o.swUrl ?? '/sw.js',
    version: o.version ?? '1',
    // Static files to cache on install. Not pages: a page can hold the
    // signed-in user's data, and would be served to the next person.
    precache: o.precache ?? [],
    offline: o.offline === undefined ? '/offline.html' : o.offline,
    // How page navigations are cached:
    //   'network-only'   always from the network; the offline page when it fails (default,
    //                    and right for pages that show a signed-in user)
    //   'network-first'  from the network, falling back to the last copy seen
    pages: o.pages ?? 'network-only',
    exclude: [...DEFAULT_EXCLUDE, ...(o.exclude ?? []).map((p) => (p instanceof RegExp ? p.source : String(p)))],
    // [{ match: '^/images/', strategy: 'cache-first' | 'stale-while-revalidate' | 'network-first' | 'network-only', maxEntries, maxAgeSeconds }]
    runtimeCaching: (o.runtimeCaching ?? []).map((r) => ({
      ...r,
      match: r.match instanceof RegExp ? r.match.source : String(r.match),
    })),
    // Register the worker in development too (off by default: it caches
    // files you are editing).
    dev: o.dev === true,
    checkEvery: o.checkEvery ?? 3600000,
    [RESOLVED]: true,
  }
}

export function manifest(input) {
  const o = resolveOptions(input)
  const out = {
    id: o.startUrl,
    name: o.name,
    short_name: o.shortName,
    description: o.description || undefined,
    lang: o.lang,
    start_url: o.startUrl,
    scope: o.scope,
    display: o.display,
    orientation: o.orientation,
    theme_color: o.themeColor,
    background_color: o.backgroundColor,
    icons: o.icons,
    shortcuts: o.shortcuts,
    screenshots: o.screenshots,
    categories: o.categories,
    ...o.manifest,
  }
  return JSON.parse(JSON.stringify(out)) // drops undefined
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// The tags for <head>: manifest link, theme colour, iOS meta, and the
// script that registers the worker and tracks install/update state.
export function headTags(input, { register = true } = {}) {
  const o = resolveOptions(input)
  const runtime = runtimeScript(o, { register })
  return [
    `<link rel="manifest" href="/manifest.webmanifest">`,
    `<meta name="theme-color" content="${escapeAttr(o.themeColor)}">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-title" content="${escapeAttr(o.shortName)}">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="default">`,
    o.appleTouchIcon ? `<link rel="apple-touch-icon" href="${escapeAttr(o.appleTouchIcon)}">` : '',
    runtime,
  ]
    .filter(Boolean)
    .join('\n  ')
}

export function runtimeScript(input, { register = true } = {}) {
  const o = resolveOptions(input)
  const config = JSON.stringify({ url: o.swUrl, scope: o.scope, register, checkEvery: o.checkEvery }).replace(/</g, '\\u003c')
  return `<script>(${installPwaRuntime.toString()})(window, ${config});</script>`
}

// A small, self-contained offline page, used when the app has no
// /offline.html of its own. Follows the system light/dark preference.
export function offlinePage(input) {
  const o = resolveOptions(input)
  const name = escapeAttr(o.name)
  return `<!doctype html>
<html lang="${escapeAttr(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline · ${name}</title>
<meta name="theme-color" content="${escapeAttr(o.themeColor)}">
<style>
  :root { --bg: #f3f2f6; --panel: #fff; --ink: #17151c; --muted: #6b6878; --line: #dedbe6; --brand: ${escapeAttr(o.themeColor)}; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17161c; --panel: #211f27; --ink: #ecebf1; --muted: #9592a3; --line: #34313d; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--ink);
    font: 15px/1.6 "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 420px; width: 100%; text-align: center; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 40px 32px; }
  .icon { width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 16px; display: grid; place-items: center; background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); }
  h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: -0.01em; }
  p { margin: 0 0 24px; color: var(--muted); }
  button { font: inherit; font-weight: 600; font-size: 14px; border: 0; border-radius: 10px; padding: 10px 20px; background: var(--brand); color: #fff; cursor: pointer; }
  small { display: block; margin-top: 16px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <div class="icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="M12 20h.01"/></svg></div>
  <h1>You’re offline</h1>
  <p>${name} can’t reach the network right now. Check your connection; this page reloads by itself when you’re back.</p>
  <button type="button" onclick="location.reload()">Try again</button>
  <small>Pages you opened before may still work.</small>
</main>
<script>addEventListener('online', function () { location.reload() })</script>
</body>
</html>`
}

// The service worker source. Strategies:
//   precached files    cache first, refreshed on every new version
//   page navigations   network only (default) or network first; the offline page when offline
//   static assets      stale-while-revalidate (fingerprinted /assets/ are cache first)
//   excluded paths     never touched (the API, dev tools, the worker itself)
export function serviceWorker(input) {
  const o = resolveOptions(input)
  const config = {
    version: String(o.version),
    precache: [...new Set(o.precache)],
    offline: o.offline || null,
    builtinOffline: o.offline ? null : offlinePage(o),
    pages: o.pages,
    exclude: o.exclude,
    runtime: o.runtimeCaching,
  }
  return `// Generated by @tylix/pwa. Served with Cache-Control: no-cache, so the
// browser sees each new version on its next check.
const CONFIG = ${JSON.stringify(config, null, 2)};
${WORKER_BODY}`
}

const WORKER_BODY = String.raw`
const STATIC = 'tylix-static-' + CONFIG.version;
const RUNTIME = 'tylix-runtime';
const PAGES = 'tylix-pages';
const EXCLUDE = CONFIG.exclude.map((p) => new RegExp(p));
const RULES = CONFIG.runtime.map((r) => ({ ...r, re: new RegExp(r.match) }));
const ASSET = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC).then((cache) =>
      Promise.all(
        [...CONFIG.precache, CONFIG.offline]
          .filter(Boolean)
          .map((url) => cache.add(new Request(url, { cache: 'reload' })).catch((err) => console.warn('[pwa] could not precache', url, err))),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tylix-static-') && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function storable(response) {
  if (!response || !response.ok || response.type === 'opaque' || response.redirected) return false;
  const cc = response.headers.get('Cache-Control') || '';
  return !/no-store|private/i.test(cc);
}

async function trim(cacheName, maxEntries) {
  if (!maxEntries) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
}

function fresh(response, maxAgeSeconds) {
  if (!maxAgeSeconds || !response) return Boolean(response);
  const date = Date.parse(response.headers.get('Date') || '');
  return !date || Date.now() - date < maxAgeSeconds * 1000;
}

async function cacheFirst(request, cacheName, rule = {}) {
  const cached = await caches.match(request);
  if (cached && fresh(cached, rule.maxAgeSeconds)) return cached;
  const response = await fetch(request);
  if (storable(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    trim(cacheName, rule.maxEntries);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName, rule = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (storable(response)) {
        cache.put(request, response.clone());
        trim(cacheName, rule.maxEntries || 80);
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function networkFirst(request, cacheName, rule = {}) {
  try {
    const response = await fetch(request);
    if (storable(response)) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      trim(cacheName, rule.maxEntries || 50);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function offlineResponse() {
  if (CONFIG.offline) {
    const cached = await caches.match(CONFIG.offline);
    if (cached) return cached;
  }
  return new Response(CONFIG.builtinOffline || '<h1>Offline</h1>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function navigate(request) {
  try {
    if (CONFIG.pages === 'network-first') return await networkFirst(request, PAGES);
    return await fetch(request);
  } catch (err) {
    return offlineResponse();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const path = sameOrigin ? url.pathname : url.href;
  if (sameOrigin && EXCLUDE.some((re) => re.test(url.pathname))) return;

  const rule = RULES.find((r) => r.re.test(path));
  if (rule) {
    if (rule.strategy === 'network-only') return;
    const name = 'tylix-rule-' + rule.match;
    const run = rule.strategy === 'cache-first' ? cacheFirst : rule.strategy === 'network-first' ? networkFirst : staleWhileRevalidate;
    event.respondWith(run(request, name, rule));
    return;
  }
  if (!sameOrigin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  if (CONFIG.precache.includes(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, url.pathname.startsWith('/assets/') ? RUNTIME : STATIC));
    return;
  }
  if (ASSET.test(url.pathname)) event.respondWith(staleWhileRevalidate(request, RUNTIME));
});
`

// Served in development instead of the real worker: it removes any worker
// a production run left on this origin, so dev always sees fresh files.
export function devServiceWorker() {
  return `// Development: this worker unregisters itself and clears Tylix caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tylix-')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })(),
  );
});
`
}
