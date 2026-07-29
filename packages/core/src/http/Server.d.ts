import type { Router } from '../router/Router.js'

export type NotFoundHandler = (req: any, res: any) => boolean | void | Promise<boolean | void>

export interface ServerOptions {
  notFoundHandler?: NotFoundHandler | null
}

export declare class Server {
  constructor(router: Router, options?: ServerOptions)
  createHandler(): (req: any, res: any) => Promise<void>
  listen(port: number, callback?: () => void): import('node:http').Server
}