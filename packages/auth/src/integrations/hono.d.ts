import type { Auth, RouteOptions } from '../web.js'
type Middleware = (c: any, next: () => Promise<void>) => Promise<Response | void>
export declare function honoAuth(auth: Auth, options?: { checkRevocation?: boolean }): Middleware
export declare function honoRequireAuth(auth: Auth, options?: { checkRevocation?: boolean }): Middleware
export declare function honoAuthRoutes(auth: Auth, options?: RouteOptions): (c: any) => Promise<Response>
export { applyCookies } from '../web.js'
