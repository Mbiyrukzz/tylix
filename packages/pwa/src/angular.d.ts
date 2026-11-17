import type { Signal } from '@angular/core'
import type { PwaState, RuntimeOptions } from './client.js'
export function injectPwa(options?: RuntimeOptions): {
  state: Signal<PwaState>
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  update(): boolean
  dismissUpdate(): void
  dismissOfflineReady(): void
}
