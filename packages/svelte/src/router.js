import { readable } from './store.js'

// A small history-API router. Svelte has no official router outside
// SvelteKit, and SvelteKit brings its own server, so this covers what a
// Tylix-hosted app needs:
//   route        store of the current location
//   navigate()   go somewhere without a page load
//   matchPath()  match "/posts/:id"-style patterns
// While anything subscribes to `route`, clicks on internal <a href> links
// are handled here instead of reloading the page.
//
// URLs are real paths (/dashboard), not hashes, so the server-side
// protected-page redirects and ?next= keep working.

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

function currentLocation() {
  if (!isBrowser) return { path: '/', search: '', query: new URLSearchParams() }
  return {
    path: window.location.pathname,
    search: window.location.search,
    query: new URLSearchParams(window.location.search),
  }
}

const listeners = new Set()
function notify() {
  for (const update of [...listeners]) update()
}

// Links the router must leave to the browser: other sites, new tabs,
// downloads, and the server's own URLs (/api/..., e.g. the email
// verification link). Add data-native to any <a> to opt out by hand.
export function shouldHandleClick(event, anchor, origin) {
  if (event.defaultPrevented || event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (!anchor || !anchor.hasAttribute('href')) return false
  if (anchor.hasAttribute('download') || anchor.hasAttribute('data-native')) return false
  const target = anchor.getAttribute('target')
  if (target && target !== '_self') return false
  if ((anchor.getAttribute('rel') ?? '').split(/\s+/).includes('external')) return false

  const url = new URL(anchor.href, origin)
  if (url.origin !== origin) return false
  if (url.pathname.startsWith('/api/')) return false
  return true
}

export const route = readable(currentLocation(), (set) => {
  if (!isBrowser) return undefined
  const update = () => set(currentLocation())
  const onClick = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    if (!shouldHandleClick(event, anchor, window.location.origin)) return
    event.preventDefault()
    const url = new URL(anchor.href)
    navigate(url.pathname + url.search + url.hash)
  }

  listeners.add(update)
  window.addEventListener('popstate', update)
  document.addEventListener('click', onClick)
  update()
  return () => {
    listeners.delete(update)
    window.removeEventListener('popstate', update)
    document.removeEventListener('click', onClick)
  }
})

export function navigate(to, { replace = false } = {}) {
  if (!isBrowser) return
  const current = window.location.pathname + window.location.search + window.location.hash
  if (to === current) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to)
  if (!replace) window.scrollTo(0, 0)
  notify()
}

// "/posts/:id" against "/posts/42" -> { id: "42" }; no match -> null.
// "*" as the last segment matches the rest of the path.
export function matchPath(pattern, path) {
  const clean = (p) => p.replace(/\/+$/, '').split('/').filter(Boolean)
  const want = clean(pattern)
  const have = clean(path)
  const params = {}
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]
    if (segment === '*') {
      params['*'] = have.slice(i).map(decodeURIComponent).join('/')
      return params
    }
    if (i >= have.length) return null
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(have[i])
    else if (segment !== have[i]) return null
  }
  return want.length === have.length ? params : null
}
