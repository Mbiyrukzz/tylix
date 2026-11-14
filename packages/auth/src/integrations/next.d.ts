import type { Auth, CurrentSession, ProtectRule, RouteOptions } from '../web.js'
export declare function nextAuthHandlers(auth: Auth, options?: RouteOptions): {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
  DELETE: (request: Request) => Promise<Response>
}
export declare function nextMiddleware(
  auth: Auth,
  options?: { protect?: ProtectRule; guestOnly?: ProtectRule; loginPath?: string; homePath?: string },
): (request: Request) => Promise<Response | undefined>
export declare function withNextSession<C extends object = {}>(
  auth: Auth,
  handler: (request: Request, context: C & { session: CurrentSession | null }) => Response | Promise<Response>,
  options?: { optional?: boolean; checkRevocation?: boolean },
): (request: Request, context?: C) => Promise<Response>
export { jsonWithCookies, redirectWithCookies } from '../web.js'
