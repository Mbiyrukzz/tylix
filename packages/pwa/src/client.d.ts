export interface PwaState {
  /** The browser supports service workers. */
  supported: boolean
  registered: boolean
  /** The first install finished: the app now works offline. */
  offlineReady: boolean
  /** A new version is installed and waiting; update() switches to it. */
  updateAvailable: boolean
  /** The browser offered installation; install() shows its dialog. */
  installable: boolean
  /** Running as an installed app. */
  installed: boolean
  online: boolean
  error: string | null
}

export interface Pwa {
  readonly state: PwaState
  /** Calls fn now and on every change. Returns the unsubscribe function (Svelte store contract). */
  subscribe(fn: (state: PwaState) => void): () => void
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  /** Activates the waiting version and reloads. False when none is waiting. */
  update(): boolean
  dismissUpdate(): void
  dismissOfflineReady(): void
  register(): Promise<ServiceWorkerRegistration | null>
  unregister(): Promise<boolean>
}

export interface RuntimeOptions {
  /** Default "/sw.js". */
  url?: string
  /** Default "/". */
  scope?: string
  /** Register the worker. Default true. */
  register?: boolean
  /** Milliseconds between update checks (0: never). Default one hour. */
  checkEvery?: number
}

/** The app's PWA instance (shared, created on first use). */
export function pwa(options?: RuntimeOptions): Pwa
export function installPwaRuntime(win: Window, options?: RuntimeOptions): Pwa

declare global {
  interface Window {
    __TYLIX_PWA__?: Pwa
  }
}
