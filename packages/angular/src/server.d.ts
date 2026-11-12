import type { ApplicationRef } from '@angular/core'
import type { BootstrapContext } from '@angular/platform-browser'
import type { ApiResult, TylixUser } from '@tylix/client'

export interface RenderOptions {
  url?: string
  session?: { user: TylixUser | null } | null
  load?: (url: string) => Promise<{ status: number; data: unknown }>
}

export interface RenderResult {
  html: string
  head: string
  status: number
  redirect: string | null
  data: Record<string, ApiResult>
}

export function renderWithData(
  bootstrap: (context: BootstrapContext) => Promise<ApplicationRef>,
  options?: RenderOptions,
): Promise<RenderResult>
