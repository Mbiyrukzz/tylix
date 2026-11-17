// Angular: the PWA state as a signal.
//
//   pwa = injectPwa()
//   @if (pwa.state().updateAvailable) { <button (click)="pwa.update()">Reload</button> }
import { DestroyRef, inject, signal } from '@angular/core'
import { pwa } from './client.js'

export function injectPwa(options) {
  const instance = pwa(options)
  const state = signal(instance.state)
  const stop = instance.subscribe((next) => state.set(next))
  inject(DestroyRef, { optional: true })?.onDestroy(stop)
  return {
    state: state.asReadonly(),
    install: () => instance.install(),
    update: () => instance.update(),
    dismissUpdate: () => instance.dismissUpdate(),
    dismissOfflineReady: () => instance.dismissOfflineReady(),
  }
}
