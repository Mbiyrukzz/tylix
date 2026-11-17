// The PWA state in the browser, for any framework:
//
//   import { pwa } from '@tylix/pwa/client'
//   pwa().subscribe((s) => console.log(s.installable, s.updateAvailable, s.online))
//   await pwa().install()       // the browser's install dialog
//   pwa().update()              // switch to the new version and reload
//
// In a Tylix app the server already started it (config pwa); this returns
// that same instance. Elsewhere the first call starts it and registers
// /sw.js (pass options to change that).
import { installPwaRuntime } from './runtime.js'

const SERVER_STATE = Object.freeze({
  supported: false,
  registered: false,
  offlineReady: false,
  updateAvailable: false,
  installable: false,
  installed: false,
  online: true,
  error: null,
})

// During server rendering there is no window: a fixed, inert stand-in.
const inert = {
  state: SERVER_STATE,
  subscribe(fn) {
    fn(SERVER_STATE)
    return () => {}
  },
  install: async () => 'unavailable',
  update: () => false,
  dismissUpdate() {},
  dismissOfflineReady() {},
  register: async () => null,
  unregister: async () => false,
}

export function pwa(options) {
  if (typeof window === 'undefined') return inert
  return installPwaRuntime(window, options)
}

export { installPwaRuntime }
