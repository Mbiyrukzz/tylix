import type { Auth, CurrentSession, ProtectRule, RouteOptions } from '../web.js'
type H3Event = any
export declare function h3AuthHandler(auth: Auth, options?: RouteOptions): (event: H3Event) => Promise<unknown>
export declare function h3AuthMiddleware(auth: Auth, options?: { protect?: ProtectRule; loginPath?: string }): (event: H3Event) => Promise<void>
export declare function requireH3Session(auth: Auth, event: H3Event, options?: { checkRevocation?: boolean }): Promise<CurrentSession>
export { applyCookies } from '../web.js'
