import type { ApiOptions, ApiResult, TylixUser } from '@tylix/client'

export { api, auth } from '@tylix/client'
export type { ApiOptions, ApiResult, TylixUser } from '@tylix/client'

/** Svelte's store contract, so $-syntax works on every store here. */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void
}

export interface Session {
  status: 'loading' | 'authenticated' | 'guest'
  user: TylixUser | null
  /** True after a session ended because it could not be refreshed. */
  expired: boolean
  loading: boolean
  isAuthenticated: boolean
}

export const session: Readable<Session>

export interface ApiState<T> {
  ok: boolean
  status: number | null
  data: T | null
  error: string | null
  errors: Record<string, string[]> | null
  loading: boolean
}

export interface ApiStore<T> extends Readable<ApiState<T>> {
  reload(): Promise<ApiResult<T> | null>
}

export function useApi<T = unknown>(url: string | null, options?: ApiOptions): ApiStore<T>

export interface Route {
  path: string
  search: string
  query: URLSearchParams
}

export const route: Readable<Route>
export function navigate(to: string, options?: { replace?: boolean }): void
export function matchPath(pattern: string, path: string): Record<string, string> | null

/** What a component can change about the server response during SSR. */
export interface ServerRenderContext {
  status: number
  redirect: string | null
}

export const serverContextKey: unique symbol

/** The server render's context during SSR; null in the browser. Call at component init. */
export function useServerContext(): ServerRenderContext | null

/** The session for this component: the request's on the server, the shared store in the browser. */
export function useSession(): Readable<Session>

/** The location for this component: the request's on the server, the router's in the browser. */
export function useRoute(): Readable<Route>

/** A live channel: connects once mounted, reconnects, closes with the component. Call at init. */
export function useChannel<T = unknown>(
  name: string,
  onMessage?: (data: T) => void,
): { send(data: unknown): void; status: Readable<import('@tylix/client').ChannelStatus> }

/** False on the server and during hydration, true once mounted. */
export function useHydrated(): Readable<boolean>
