import type { DeepReadonly, Ref } from 'vue'
import type { PwaState, RuntimeOptions } from './client.js'
export function usePwa(options?: RuntimeOptions): {
  state: DeepReadonly<Ref<PwaState>>
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  update(): boolean
  dismissUpdate(): void
  dismissOfflineReady(): void
}
