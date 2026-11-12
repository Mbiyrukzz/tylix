import type { App } from 'vue'
import type { ApiResult, TylixUser } from '@tylix/client'

export interface ServerContext {
  authState: { status: 'authenticated'; user: TylixUser } | { status: 'guest'; user: null }
  load(url: string): Promise<{ status: number; data: unknown }>
  data: Record<string, ApiResult>
  status: number
  redirect: string | null
}

export function createServerContext(options?: {
  session?: { user: TylixUser | null } | null
  load?: (url: string) => Promise<{ status: number; data: unknown }>
}): ServerContext

export interface RenderResult {
  html: string
  status: number
  redirect: string | null
  data: Record<string, ApiResult>
}

export function renderWithData(app: App, context: ServerContext): Promise<RenderResult>
