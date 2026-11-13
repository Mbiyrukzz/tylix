import type { Context, ErrorInfo, ReactNode } from 'react'
import type { Api, ApiOptions, ApiResult, Auth, TylixUser } from '@tylix/client'

export { api, auth } from '@tylix/client'
export type { ApiOptions, ApiResult, TylixUser } from '@tylix/client'

export interface UseAuthResult {
  status: 'loading' | 'authenticated' | 'guest'
  user: TylixUser | null
  /** True after a session ended because it could not be refreshed. */
  expired: boolean
  loading: boolean
  isAuthenticated: boolean
  login: Auth['login']
  register: Auth['register']
  logout: Auth['logout']
  reload: Auth['reload']
  forgotPassword: Auth['forgotPassword']
  resetPassword: Auth['resetPassword']
}

export function useAuth(): UseAuthResult

export interface GuardProps {
  children?: ReactNode
  /** Rendered when the guard does not pass, e.g. a redirect. */
  fallback?: ReactNode
  /** Rendered while the session is still being checked. */
  loading?: ReactNode
}

export function RequireAuth(props: GuardProps): ReactNode
export function GuestOnly(props: GuardProps): ReactNode

export interface UseApiResult<T> {
  ok: boolean
  status: number | null
  data: T | null
  error: string | null
  errors: Record<string, string[]> | null
  loading: boolean
  reload(): Promise<ApiResult<T> | null>
}

export interface UseChannel {
  /** Sends JSON to the channel; queued until connected. */
  send(data: unknown): void
  status: import('@tylix/client').ChannelStatus
}

/** A live channel: connects once mounted, reconnects, closes on unmount. */
export function useChannel<T = unknown>(name: string, onMessage?: (data: T) => void): UseChannel

export function useApi<T = any>(url: string | null, options?: ApiOptions): UseApiResult<T>

export type { Api }

/** What a component can change about the server response during SSR. */
export interface ServerRenderContext {
  /** HTTP status of the page, 200 unless a component sets it (e.g. 404). */
  status: number
  /** Set to a path to answer with a 302 redirect instead of the page. */
  redirect: string | null
}

export const ServerContext: Context<ServerRenderContext | null>

/** The server render's context while rendering on the server; null in the browser. */
export function useServerContext(): ServerRenderContext | null

/** False on the server and during hydration, true once React runs the page. */
export function useHydrated(): boolean

export interface ErrorFallbackProps {
  error: unknown
  /** Renders the children again. */
  reset: () => void
}

export interface ErrorBoundaryProps {
  children?: ReactNode
  /**
   * Shown instead of the children after one of them threw while rendering:
   * an element, or a function given { error, reset }. (The element side is
   * spelled out rather than ReactNode so the function's parameters stay
   * typed even where React's types don't resolve.)
   */
  fallback?: ((props: ErrorFallbackProps) => ReactNode) | object | string | number | boolean | null
  /** When this changes (the URL, usually), the children render again. */
  resetKey?: unknown
  /** Called with every caught error, e.g. to report it. */
  onError?: (error: unknown, info: ErrorInfo) => void
}

/**
 * Shows `fallback` when a component inside it throws while rendering.
 * (A class component at runtime; typed as a component function so it
 * type-checks even where React's own types don't resolve.)
 */
export const ErrorBoundary: (props: ErrorBoundaryProps) => ReactNode
