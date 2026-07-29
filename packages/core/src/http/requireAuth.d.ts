import type { Handler } from '../router/Router.js'

export declare function requireAuth(handler: Handler, secret: string): Handler