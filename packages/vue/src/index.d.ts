import type { ComputedRef, InjectionKey, MaybeRefOrGetter, Ref, ShallowRef } from 'vue'
import type { ApiOptions, ApiResult, Auth, TylixUser } from '@tylix/client'

export { api, auth } from '@tylix/client'
export type { ApiOptions, ApiResult, TylixUser } from '@tylix/client'

export interface UseAuth {
  status: ComputedRef<'loading' | 'authenticated' | 'guest'>
  user: ComputedRef<TylixUser | null>
  /** True after a session ended because it could not be refreshed. */
  expired: ComputedRef<boolean>
  loading: ComputedRef<boolean>
  isAuthenticated: ComputedRef<boolean>
  login: Auth['login']
  register: Auth['register']
  logout: Auth['logout']
  reload: Auth['reload']
  forgotPassword: Auth['forgotPassword']
  resetPassword: Auth['resetPassword']
}

export function useAuth(): UseAuth

/** Resolves once the first session check is done (for router guards). */
export function sessionReady(): Promise<void>

export interface UseApi<T> {
  data: ShallowRef<T | null>
  error: Ref<string | null>
  errors: ShallowRef<Record<string, string[]> | null>
  status: Ref<number | null>
  ok: Ref<boolean>
  loading: Ref<boolean>
  reload(): Promise<ApiResult<T> | null>
}

export function useApi<T = unknown>(
  url: MaybeRefOrGetter<string | null>,
  options?: MaybeRefOrGetter<ApiOptions | undefined>,
): UseApi<T>

/** What a component can change about the server response during SSR. */
export interface ServerRenderContext {
  status: number
  redirect: string | null
  authState: { status: 'authenticated' | 'guest'; user: TylixUser | null }
}

export const serverContextKey: InjectionKey<ServerRenderContext>

/** The server render's context while rendering on the server; null in the browser. */
export function useServerContext(): ServerRenderContext | null

/** A live channel: connects once mounted, reconnects, closes with the component. */
export function useChannel<T = unknown>(
  name: string,
  onMessage?: (data: T) => void,
): { send(data: unknown): void; status: Ref<import('@tylix/client').ChannelStatus> }

/** False on the server and during hydration, true once mounted. */
export function useHydrated(): Ref<boolean>
