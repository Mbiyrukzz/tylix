import type { InjectionToken, Signal } from '@angular/core'
import type { CanActivateFn } from '@angular/router'
import type { HttpInterceptorFn } from '@angular/common/http'
import type { ApiOptions, ApiResult, Auth, TylixUser } from '@tylix/client'

export { api, auth } from '@tylix/client'
export type { ApiOptions, ApiResult, TylixUser } from '@tylix/client'

export interface InjectedAuth {
  status: Signal<'loading' | 'authenticated' | 'guest'>
  user: Signal<TylixUser | null>
  /** True after a session ended because it could not be refreshed. */
  expired: Signal<boolean>
  loading: Signal<boolean>
  isAuthenticated: Signal<boolean>
  login: Auth['login']
  register: Auth['register']
  logout: Auth['logout']
  reload: Auth['reload']
  forgotPassword: Auth['forgotPassword']
  resetPassword: Auth['resetPassword']
}

export function injectAuth(): InjectedAuth

/** Resolves once the first session check is done. */
export function sessionReady(): Promise<void>

export interface InjectedApi<T> {
  data: Signal<T | null>
  error: Signal<string | null>
  errors: Signal<Record<string, string[]> | null>
  status: Signal<number | null>
  ok: Signal<boolean>
  loading: Signal<boolean>
  reload(): Promise<ApiResult<T> | null>
}

/** Call in an injection context. `url` may read signals; null skips fetching. */
export function injectApi<T = unknown>(url: string | null | (() => string | null), options?: ApiOptions): InjectedApi<T>

export const authGuard: CanActivateFn
export const guestGuard: CanActivateFn
export const tylixInterceptor: HttpInterceptorFn

/** Same-site ?next= path, else '/dashboard'. */
export function nextPath(next: unknown): string

export type AccessDecision = null | { login: string } | { to: string }
export function decideAccess(
  access: 'auth' | 'guest' | undefined,
  status: 'loading' | 'authenticated' | 'guest',
  url: string,
  next?: unknown,
): AccessDecision

/** What a component can change about the server response during SSR. */
export interface ServerRenderContext {
  status: number
  redirect: string | null
}

export const TYLIX_SERVER: InjectionToken<ServerRenderContext>

/** The server render's context during SSR; null in the browser. */
export function useServerContext(): ServerRenderContext | null

/** A live channel: connects after the first browser render, reconnects, closes on destroy. Injection context. */
export function injectChannel<T = unknown>(
  name: string,
  onMessage?: (data: T) => void,
): { send(data: unknown): void; status: Signal<import('@tylix/client').ChannelStatus> }

/** False on the server and during hydration, true after the first browser render. Injection context. */
export function injectHydrated(): Signal<boolean>
