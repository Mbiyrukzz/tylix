import type { RuntimeOptions } from './client.js'
export type { Pwa, PwaState, RuntimeOptions } from './client.js'
export { installPwaRuntime } from './client.js'

export interface ManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose?: 'any' | 'maskable' | 'monochrome' | string
}

export interface RuntimeCachingRule {
  /** A RegExp or regex source, tested on the path (same origin) or full URL. */
  match: RegExp | string
  strategy: 'cache-first' | 'stale-while-revalidate' | 'network-first' | 'network-only'
  maxEntries?: number
  maxAgeSeconds?: number
}

export interface PwaOptions {
  name?: string
  shortName?: string
  description?: string
  lang?: string
  startUrl?: string
  scope?: string
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
  orientation?: string
  themeColor?: string
  backgroundColor?: string
  icons?: ManifestIcon[]
  appleTouchIcon?: string | null
  shortcuts?: { name: string; url: string; short_name?: string; description?: string; icons?: ManifestIcon[] }[]
  screenshots?: { src: string; sizes: string; type?: string; form_factor?: 'wide' | 'narrow'; label?: string }[]
  categories?: string[]
  /** Extra manifest fields, merged last. */
  manifest?: Record<string, unknown>

  swUrl?: string
  /** Changes when the precached files change; a new version prompts an update. */
  version?: string
  /** Static files cached on install. Not pages. */
  precache?: string[]
  /** Path of the offline page, or null for the built-in one. Default "/offline.html". */
  offline?: string | null
  /** "network-only" (default) or "network-first" for page navigations. */
  pages?: 'network-only' | 'network-first'
  /** Paths the worker never touches, besides /api/ and dev tools. */
  exclude?: (RegExp | string)[]
  runtimeCaching?: RuntimeCachingRule[]
  /** Register the worker in development too. */
  dev?: boolean
  /** Milliseconds between update checks. Default one hour. */
  checkEvery?: number
}

export type ResolvedPwaOptions = Required<Omit<PwaOptions, 'orientation' | 'shortcuts' | 'screenshots' | 'categories' | 'exclude' | 'runtimeCaching'>> &
  Pick<PwaOptions, 'orientation' | 'shortcuts' | 'screenshots' | 'categories'> & {
    exclude: string[]
    runtimeCaching: (RuntimeCachingRule & { match: string })[]
  }

export const DEFAULT_EXCLUDE: readonly string[]
export function resolveOptions(options?: PwaOptions | true): ResolvedPwaOptions
export function manifest(options?: PwaOptions | true): Record<string, unknown>
/** <link rel="manifest">, theme colour, iOS tags, and the runtime script. */
export function headTags(options?: PwaOptions | true, opts?: { register?: boolean }): string
export function runtimeScript(options?: PwaOptions | true, opts?: { register?: boolean }): string
/** The service worker's source, to serve at /sw.js with Cache-Control: no-cache. */
export function serviceWorker(options?: PwaOptions | true): string
/** A worker that removes itself and the caches (for development). */
export function devServiceWorker(): string
/** A self-contained offline page. */
export function offlinePage(options?: PwaOptions | true): string
export type { RuntimeOptions as ClientOptions }
