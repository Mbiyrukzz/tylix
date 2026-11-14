export declare const ACCESS_TOKEN_COOKIE: string
export declare const REFRESH_TOKEN_COOKIE: string
export declare const REFRESH_TOKEN_PATH: string

export interface SetAuthCookiesOptions {
  accessToken?: string
  refreshToken?: string
  accessTtlSeconds?: number
  refreshTtlSeconds?: number
}

type Res = { setHeader(name: string, value: string | string[]): unknown; getHeader?(name: string): unknown }
type Req = { headers?: Record<string, unknown>; cookies?: Record<string, string> }

export declare function setAuthCookies(res: Res, options?: SetAuthCookiesOptions): void
export declare function clearAuthCookies(res: Res): void
export declare function readAccessToken(req: Req): string | null
export declare function readRefreshToken(req: Req): string | null
