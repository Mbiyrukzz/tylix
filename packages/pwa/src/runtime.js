// The browser side of a Tylix PWA. One self-contained function: the server
// inlines it into every page (installPwaRuntime.toString()), and
// @tylix/pwa/client calls it, so native pages and React, Vue, Svelte and
// Angular apps share the same instance at window.__TYLIX_PWA__.
//
// Nothing here may refer to anything outside the function body.
export function installPwaRuntime(win, options) {
  if (win.__TYLIX_PWA__) return win.__TYLIX_PWA__
  var opts = Object.assign({ url: '/sw.js', scope: '/', register: true, checkEvery: 3600000 }, options || {})
  var nav = win.navigator
  var listeners = new Set()
  var deferredPrompt = null
  var registration = null
  var updating = false

  function standalone() {
    try {
      return (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true
    } catch (e) {
      return false
    }
  }

  var state = {
    supported: Boolean(nav && 'serviceWorker' in nav),
    registered: false,
    offlineReady: false,
    updateAvailable: false,
    installable: false,
    installed: standalone(),
    online: !nav || nav.onLine !== false,
    error: null,
  }

  function set(patch) {
    state = Object.assign({}, state, patch)
    listeners.forEach(function (fn) {
      try {
        fn(state)
      } catch (err) {
        console.error('[pwa] listener failed:', err)
      }
    })
    try {
      win.dispatchEvent(new win.CustomEvent('tylix:pwa', { detail: state }))
    } catch (e) {}
  }

  win.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault()
    deferredPrompt = event
    set({ installable: true })
  })
  win.addEventListener('appinstalled', function () {
    deferredPrompt = null
    set({ installable: false, installed: true })
  })
  win.addEventListener('online', function () {
    set({ online: true })
  })
  win.addEventListener('offline', function () {
    set({ online: false })
  })

  function watch(worker) {
    worker.addEventListener('statechange', function () {
      if (worker.state !== 'installed') return
      // A worker installed while another controls the page is an update
      // waiting for the user; the first one ever means offline is ready.
      if (nav.serviceWorker.controller) set({ updateAvailable: true })
      else set({ offlineReady: true })
    })
  }

  function register() {
    if (!state.supported) return Promise.resolve(null)
    return nav.serviceWorker
      .register(opts.url, { scope: opts.scope })
      .then(function (reg) {
        registration = reg
        set({ registered: true })
        if (reg.waiting && nav.serviceWorker.controller) set({ updateAvailable: true })
        if (reg.installing) watch(reg.installing)
        reg.addEventListener('updatefound', function () {
          if (reg.installing) watch(reg.installing)
        })
        // Reload once the new worker takes over, but only when the user
        // asked for the update: the very first install claims the page too.
        nav.serviceWorker.addEventListener('controllerchange', function () {
          if (!updating) return
          updating = false
          win.location.reload()
        })
        if (opts.checkEvery > 0) {
          setInterval(function () {
            reg.update().catch(function () {})
          }, opts.checkEvery)
        }
        return reg
      })
      .catch(function (err) {
        set({ error: String((err && err.message) || err) })
        return null
      })
  }

  var api = {
    get state() {
      return state
    },
    // Svelte's store contract: run(fn) now and on every change; returns
    // the unsubscribe function.
    subscribe: function (fn) {
      listeners.add(fn)
      fn(state)
      return function () {
        listeners.delete(fn)
      }
    },
    // Shows the browser's install dialog. Resolves 'accepted',
    // 'dismissed' or 'unavailable' (the browser didn't offer it).
    install: function () {
      if (!deferredPrompt) return Promise.resolve('unavailable')
      var prompt = deferredPrompt
      deferredPrompt = null
      prompt.prompt()
      return prompt.userChoice.then(function (choice) {
        set({ installable: false })
        return choice.outcome
      })
    },
    // Activates the waiting version and reloads the page into it.
    update: function () {
      var waiting = registration && registration.waiting
      if (!waiting) return false
      updating = true
      waiting.postMessage({ type: 'SKIP_WAITING' })
      return true
    },
    dismissUpdate: function () {
      set({ updateAvailable: false })
    },
    dismissOfflineReady: function () {
      set({ offlineReady: false })
    },
    register: register,
    unregister: function () {
      return registration ? registration.unregister() : Promise.resolve(false)
    },
  }

  win.__TYLIX_PWA__ = api
  if (opts.register && state.supported) {
    if (win.document.readyState === 'complete') register()
    else
      win.addEventListener('load', function () {
        register()
      })
  }
  return api
}
