import type { ReactNode } from 'react'
import type { ApiResult, TylixUser } from '@tylix/client'

export interface RenderOptions {
  /** The visitor's session, as the Tylix host passes it. */
  session?: { user: TylixUser | null } | null
  /** Loads one API url in-process for this visitor. */
  load?: (url: string) => Promise<{ status: number; data: unknown }>
  /** Render passes at most; each pass can load more data. Default 4. */
  maxPasses?: number
}

export interface RenderResult {
  html: string
  status: number
  redirect: string | null
  /** Loaded API results by url, embedded in the page for hydration. */
  data: Record<string, ApiResult>
}

export function renderWithData(render: () => ReactNode, options?: RenderOptions): Promise<RenderResult>
