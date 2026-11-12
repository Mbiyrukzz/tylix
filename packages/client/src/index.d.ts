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

declare global {
  // Set by the server when it already knows the session at page load.
  // eslint-disable-next-line no-var
  var __TYLIX_SESSION__: { user: TylixUser | null } | undefined
  // Set when the server rendered the page (SSR): hydrate instead of render.
  // eslint-disable-next-line no-var
  var __TYLIX_SSR__: boolean | undefined
  // API results the server render loaded, by url, reused while hydrating.
  // eslint-disable-next-line no-var
  var __TYLIX_DATA__: Record<string, ApiResult> | undefined
}
