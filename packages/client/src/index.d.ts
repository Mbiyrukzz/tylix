export interface ApiOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  credentials?: RequestCredentials
  /** Abort after this many milliseconds. 0 or omitted means no timeout. */
  timeout?: number
  signal?: AbortSignal
  /** Set to false to skip the automatic session refresh on a 401. */
  refresh?: boolean
}

export interface ApiResult<T = any> {
  ok: boolean
  /** HTTP status, or 0 when the server could not be reached. */
  status: number
  data: T
  error: string | null
  /** Field errors from a 422 response: { field: ["message"] }. */
  errors: Record<string, string[]> | null
  aborted?: boolean
}

export type Body = unknown

export interface Api {
  <T = any>(url: string, options?: ApiOptions): Promise<ApiResult<T>>
  get<T = any>(url: string, options?: ApiOptions): Promise<ApiResult<T>>
  post<T = any>(url: string, body?: Body, options?: ApiOptions): Promise<ApiResult<T>>
  put<T = any>(url: string, body?: Body, options?: ApiOptions): Promise<ApiResult<T>>
  patch<T = any>(url: string, body?: Body, options?: ApiOptions): Promise<ApiResult<T>>
  delete<T = any>(url: string, options?: ApiOptions): Promise<ApiResult<T>>
}

export interface TylixUser {
  id: number | string
  name: string
  email: string
  [key: string]: unknown
}

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: TylixUser }
  | { status: 'guest'; user: null; expired?: boolean }

export interface RegisterDetails {
  name: string
  email: string
  password: string
}

export interface Auth {
  getState(): AuthState
  subscribe(listener: (state: AuthState) => void): () => void
  init(): Promise<void>
  reload(): Promise<void>
  login(email: string, password: string): Promise<ApiResult<{ user: TylixUser }>>
  register(details: RegisterDetails): Promise<ApiResult<{ user: TylixUser; message: string }>>
  logout(): Promise<ApiResult<null>>
  forgotPassword(email: string): Promise<ApiResult<{ ok: boolean; message: string }>>
  resetPassword(details: { email: string; token: string; password: string }): Promise<ApiResult<{ ok: boolean; message: string }>>
}

export interface ClientOptions {
  baseUrl?: string
  fetch?: typeof fetch
  channel?: BroadcastChannel | null
}

export const api: Api
export const auth: Auth

/** The ApiResult for an HTTP status and parsed JSON body, as api() builds it. */
export function resultFromResponse<T = any>(status: number, data: T): ApiResult<T>

/**
 * Renews the session with the same single shared refresh api() uses, for
 * other HTTP layers (Angular's HttpClient). Resolves true when renewed; on
 * false the session is already marked expired.
 */
export function refreshSession(): Promise<boolean>

export function createClient(options?: ClientOptions): {
  api: Api & { refreshSession(): Promise<boolean> }
  auth: Auth & { expire(): void }
}

export function createApi(
  options?: ClientOptions & { onSessionExpired?: () => void },
): Api & { refreshSession(): Promise<boolean> }

export function createAuth(options: { api: Api; channel?: BroadcastChannel | null }): Auth & {
  expire(): void
}

export type ChannelStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface Channel<T = unknown> {
  /** Sends JSON; queued while connecting. */
  send(data: unknown): void
  /** Returns a function that removes the listener. */
  onMessage(listener: (data: T) => void): () => void
  onStatus(listener: (status: ChannelStatus) => void): () => void
  readonly status: ChannelStatus
  close(): void
}

export interface ChannelOptions {
  /** Channel server port; default: what the page says, else 6001. */
  port?: number
  /** Full WebSocket URL, instead of host + port + name. */
  url?: string
  /** Reconnect after a dropped connection. Default true. */
  reconnect?: boolean
}

/** A live channel on the channel server ("tylix channels:work"). */
export function channel<T = unknown>(name: string, options?: ChannelOptions): Channel<T>

/** For framework bindings: open() once mounted, close() when unmounted; send() queues until open. */
export function lazyChannel<T = unknown>(
  name: string,
  handlers?: { onMessage?: (data: T) => void; onStatus?: (status: ChannelStatus) => void },
): { open(): void; close(): void; send(data: unknown): void }

declare global {
  // Set by the server when it already knows the session at page load.
  // eslint-disable-next-line no-var
  var __TYLIX_SESSION__: { user: TylixUser | null } | undefined
  // Set when the server rendered the page (SSR): hydrate instead of render.
  // eslint-disable-next-line no-var
  var __TYLIX_SSR__: boolean | undefined
  // The channel server's port (CHANNELS_PORT), put in the page by Tylix.
  // eslint-disable-next-line no-var
  var __TYLIX_CHANNELS_PORT__: number | undefined
  // API results the server render loaded, by url, reused while hydrating.
  // eslint-disable-next-line no-var
  var __TYLIX_DATA__: Record<string, ApiResult> | undefined
}

/** The runtime of the client "tylix routes:types" generates. */
export type RouteTable = { [name: string]: [method: string, pattern: string] | RouteTable }
export function createRouteClient(api: Api, table: RouteTable): any
/** "/api/posts/:id" + { id: 7 } + { page: 2 } -> "/api/posts/7?page=2". Throws when a param is missing. */
export function buildPath(pattern: string, params?: Record<string, string | number>, query?: Record<string, unknown>): string
