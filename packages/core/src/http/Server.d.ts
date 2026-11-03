import type { Router } from '../router/Router.js'
import type { Server as HttpServer } from 'node:http'

export type NotFoundHandler = (
  req: any,
  res: any,
) => boolean | void | Promise<boolean | void>

export interface ServerOptions {
  /**
   * Called when no route matches, before the default 404 JSON response.
   * `tylix dev` uses it to serve static files from public/. Return true
   * if it handled the request; false/undefined falls through to the 404.
   */
  notFoundHandler?: NotFoundHandler | null

  /**
   * Believe X-Forwarded-For, X-Forwarded-Host and X-Forwarded-Proto.
   * Enable only behind a proxy you control (nginx).
   * Defaults to the TRUST_PROXY=true env var.
   */
  trustProxy?: boolean

  /**
   * Show real error details (debug page, SQL, stack) instead of a generic
   * 500. Defaults to the APP_DEBUG=true env var.
   */
  debug?: boolean

  /**
   * Largest request body accepted, in bytes. Bigger bodies get a 413.
   * Defaults to the MAX_BODY_BYTES env var, then 1 MB.
   */
  maxBodyBytes?: number
}

export declare class Server {
  router: Router
  notFoundHandler: NotFoundHandler | null
  trustProxy: boolean
  production: boolean
  debug: boolean
  maxBodyBytes: number
  /** Origins allowed to make cross-site browser writes (TRUSTED_ORIGINS + APP_URL). */
  trustedOrigins: Set<string>
  /** CSP_MODE: 'off' | 'report-only' | 'enforce' (lowercased, not validated). */
  cspMode: string
  csp: string

  constructor(router: Router, options?: ServerOptions)

  createHandler(): (req: any, res: any) => Promise<void>
  listen(port: number, callback?: () => void): HttpServer

  applySecurityHeaders(req: any, res: any): void
  isCrossSiteWrite(req: any): boolean
  handle(req: any, res: any): Promise<void>
  logFailure(req: any, err: any): void
  sendDebug(req: any, res: any, err: any): void
  fail(req: any, res: any, err: any): void
}