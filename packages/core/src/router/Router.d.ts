export type Handler = (
  req: any,
  res: any,
  next: () => Promise<void>,
) => void | Promise<void>

interface Route {
  method: string
  pattern: string
  regex: RegExp
  keys: string[]
  routeMiddleware: Handler[]
  finalHandler: Handler
}

export declare class Router {
  routes: Route[]
  middlewares: Handler[]
  use(fn: Handler): this
  register(method: string, pattern: string, ...handlers: Handler[]): this
  get(pattern: string, ...handlers: Handler[]): this
  post(pattern: string, ...handlers: Handler[]): this
  put(pattern: string, ...handlers: Handler[]): this
  delete(pattern: string, ...handlers: Handler[]): this
  match(
    method: string,
    url: string,
  ): { handler: Handler; params: Record<string, string> } | null
}