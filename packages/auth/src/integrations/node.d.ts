import type { Auth, RouteOptions } from '../web.js'
export declare function expressAuth(auth: Auth, options?: RouteOptions): (req: any, res: any, next: (error?: unknown) => void) => Promise<void>
export declare function requireExpressAuth(): (req: any, res: any, next: () => void) => void
export declare function fastifyAuth(app: any, auth: Auth, options?: RouteOptions): void
export declare function requireFastifyAuth(): (request: any, reply: any) => Promise<unknown>
export declare function koaAuth(auth: Auth, options?: RouteOptions): (ctx: any, next: () => Promise<unknown>) => Promise<void>
export { applyCookies } from '../web.js'
