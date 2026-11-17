import type { PwaState, RuntimeOptions } from './client.js'
export function usePwa(options?: RuntimeOptions): PwaState & {
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  update(): boolean
  dismissUpdate(): void
  dismissOfflineReady(): void
}
