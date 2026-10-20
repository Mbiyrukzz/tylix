import type { Router } from '../router/Router.js'

export type NotFoundHandler = (req: any, res: any) => boolean | void | Promise<boolean | void>

export interface ServerOptions {
  notFoundHandler?: NotFoundHandler | null
  /**
   * Believe X-Forwarded-For and X-Forwarded-Proto. Enable only behind a
   * proxy you control (nginx). Defaults to the TRUST_PROXY=true env var.
   */
  trustProxy?: boolean
}

export declare class Server {
  constructor(router: Router, options?: ServerOptions)
  createHandler(): (req: any, res: any) => Promise<void>
  listen(port: number, callback?: () => void): import('node:http').Server
}

export declare function readBody(req: any): Promise<{ raw: string; body: any }>