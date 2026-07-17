function compose(fns) {
  return async function (req, res) {
    let index = -1
    async function dispatch(i) {
      if (i <= index) {
        throw new Error('next() called multiple times in one middleware chain')
      }
      index = i
      const fn = fns[i]
      if (!fn) return
      await fn(req, res, () => dispatch(i + 1))
    }
    return dispatch(0)
  }
}

export class Router {
  constructor() {
    this.routes = []
    this.middlewares = []
  }

  // Global middleware, run before every route match, in registration
  // order. e.g. router.use(loggerMiddleware).
  use(fn) {
    this.middlewares.push(fn)
    return this
  }

  register(method, pattern, ...handlers) {
    if (handlers.length === 0) {
      throw new Error(
        `Router.${method.toLowerCase()}("${pattern}") needs a handler`,
      )
    }
    const finalHandler = handlers[handlers.length - 1]
    const routeMiddleware = handlers.slice(0, -1)

    const keys = []
    const regexPattern = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1))
          return '([^/]+)'
        }
        return segment
      })
      .join('/')

    const regex = new RegExp(`^${regexPattern}$`)
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      regex,
      keys,
      routeMiddleware,
      finalHandler,
    })
    return this
  }

  get(pattern, ...handlers) {
    return this.register('GET', pattern, ...handlers)
  }

  post(pattern, ...handlers) {
    return this.register('POST', pattern, ...handlers)
  }

  put(pattern, ...handlers) {
    return this.register('PUT', pattern, ...handlers)
  }

  delete(pattern, ...handlers) {
    return this.register('DELETE', pattern, ...handlers)
  }

  match(method, url) {
    const pathname = url.split('?')[0]

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue

      const result = route.regex.exec(pathname)
      if (!result) continue

      const params = {}
      route.keys.forEach((key, i) => {
        params[key] = result[i + 1]
      })

      const chain = compose([
        ...this.middlewares,
        ...route.routeMiddleware,
        route.finalHandler,
      ])
      return { handler: chain, params }
    }

    return null
  }
}
