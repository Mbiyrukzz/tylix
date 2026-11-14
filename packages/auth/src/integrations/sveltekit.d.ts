import type { Auth, ProtectRule, RouteOptions } from '../web.js'
export declare function sveltekitHandle(
  auth: Auth,
  options?: RouteOptions & { protect?: ProtectRule; loginPath?: string },
): (input: { event: any; resolve: (event: any) => Response | Promise<Response> }) => Promise<Response>
