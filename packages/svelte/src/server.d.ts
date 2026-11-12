import type { Component } from 'svelte'
import type { ApiResult, TylixUser } from '@tylix/client'

export interface RenderOptions {
  /** The requested path and query. */
  url?: string
  /** The visitor's session, as the Tylix host passes it. */
  session?: { user: TylixUser | null } | null
  /** Loads one API url in-process for this visitor. */
  load?: (url: string) => Promise<{ status: number; data: unknown }>
  props?: Record<string, unknown>
  /** Render passes at most; each pass can load more data. Default 4. */
  maxPasses?: number
}

export interface RenderResult {
  html: string
  head: string
  status: number
  redirect: string | null
  data: Record<string, ApiResult>
}

export function renderWithData(App: Component<any>, options?: RenderOptions): Promise<RenderResult>
