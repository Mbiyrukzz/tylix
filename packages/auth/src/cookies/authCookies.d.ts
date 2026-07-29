import type { TylixRequest, TylixResponse } from '@tylix/core'

export declare const ACCESS_TOKEN_COOKIE: string
export declare const REFRESH_TOKEN_COOKIE: string

export interface SetAuthCookiesOptions {
  accessToken?: string
  refreshToken?: string
  accessTtlSeconds?: number
  refreshTtlSeconds?: number
}

export declare function setAuthCookies(res: TylixResponse, options?: SetAuthCookiesOptions): void
export declare function clearAuthCookies(res: TylixResponse): void
export declare function readAccessToken(req: TylixRequest): string | null
export declare function readRefreshToken(req: TylixRequest): string | null