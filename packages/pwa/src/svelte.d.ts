import type { PwaState } from './client.js'
export const pwa: {
  subscribe(run: (state: PwaState) => void): () => void
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  update(): boolean
  dismissUpdate(): void
  dismissOfflineReady(): void
}
