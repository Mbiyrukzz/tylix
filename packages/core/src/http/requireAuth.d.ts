import type { Handler } from '../router/Router.js'

export interface RequireAuthOptions {
  /**
   * Runs after the token is verified. Return an object to merge into
   * req.user, return null/false to reject with 401, or throw for a 500.
   */
  hydrate?: (payload: any, req: any) => unknown | Promise<unknown>
}

export declare function requireAuth(
  handler: Handler,
  secret: string,
  options?: RequireAuthOptions,
): Handler