// Routes are kept in a tree of path segments, so a lookup walks the URL's
// segments instead of testing every route's pattern in turn: the cost
// grows with the length of the path, not the number of routes. Exact
// paths ("/api/health") skip the tree entirely through a Map.
//
// When several routes match the same URL (say "/users/:id" and
// "/users/me"), the one registered first wins, as it always has.
//
// Each route's middleware chain is built once and reused, and rebuilt
// only when router.use() adds middleware.

function compose(fns) {
  if (fns.length === 1) {
    const [only] = fns
    return (req, res) => only(req, res, () => {})
  }
  return function (req, res) {
    let index = -1
    function dispatch(i) {
      if (i <= index) {
        return Promise.reject(new Error('next() called multiple times in one middleware chain'))
      }
      index = i
      const fn = fns[i]
      if (!fn) return Promise.resolve()
      try {
        return Promise.resolve(fn(req, res, () => dispatch(i + 1)))
      } catch (err) {
        return Promise.reject(err)
      }
    }
    return dispatch(0)
  }
}

function createNode() {
  return { statics: new Map(), param: null, routes: null }
}

export class Router {
  constructor() {
    this.routes = []
    this.middlewares = []
    // "GET /api/health" -> routes without parameters, by method and path.
    this.exact = new Map()
    this.tree = createNode()
    this.firstParamOrder = Infinity
    this.version = 0
  }

  // Global middleware, run before every route match, in registration
  // order. e.g. router.use(loggerMiddleware).
  use(fn) {
    this.middlewares.push(fn)
    this.version++ // chains built before this need rebuilding
    return this
  }

  register(method, pattern, ...handlers) {
    if (handlers.length === 0) {
      throw new Error(`Router.${method.toLowerCase()}("${pattern}") needs a handler`)
    }
    const segments = pattern.split('/')
    const keys = segments.filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1))
    const route = {
      method: method.toUpperCase(),
      pattern,
      keys,
      order: this.routes.length,
      routeMiddleware: handlers.slice(0, -1),
      finalHandler: handlers[handlers.length - 1],
      chain: null,
      chainVersion: -1,
    }
    this.routes.push(route)

    if (keys.length === 0) {
      const id = `${route.method} ${pattern}`
      if (!this.exact.has(id)) this.exact.set(id, route) // the first one wins
      return this
    }

    this.firstParamOrder = Math.min(this.firstParamOrder, route.order)
    let node = this.tree
    for (const segment of segments) {
      if (segment.startsWith(':')) {
        node.param ??= createNode()
        node = node.param
      } else {
        if (!node.statics.has(segment)) node.statics.set(segment, createNode())
        node = node.statics.get(segment)
      }
    }
    node.routes ??= new Map()
    const list = node.routes.get(route.method) ?? []
    list.push(route)
    node.routes.set(route.method, list)
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

  patch(pattern, ...handlers) {
    return this.register('PATCH', pattern, ...handlers)
  }

  delete(pattern, ...handlers) {
    return this.register('DELETE', pattern, ...handlers)
  }

  // The earliest-registered route for this method under `node`, matching
  // segments[i..], with the values its parameters captured.
  find(node, segments, i, method, captured) {
    if (i === segments.length) {
      const route = node.routes?.get(method)?.[0]
      return route ? { route, values: captured.slice() } : null
    }
    let best = null
    const next = node.statics.get(segments[i])
    if (next) best = this.find(next, segments, i + 1, method, captured)
    // A parameter matches any non-empty segment, like the old ([^/]+).
    if (node.param && segments[i] !== '') {
      captured.push(segments[i])
      const viaParam = this.find(node.param, segments, i + 1, method, captured)
      captured.pop()
      if (viaParam && (!best || viaParam.route.order < best.route.order)) best = viaParam
    }
    return best
  }

  chainOf(route) {
    if (route.chainVersion !== this.version) {
      route.chain = compose([...this.middlewares, ...route.routeMiddleware, route.finalHandler])
      route.chainVersion = this.version
    }
    return route.chain
  }

  match(method, url) {
    const queryAt = url.indexOf('?')
    const pathname = queryAt === -1 ? url : url.slice(0, queryAt)
    const upper = method.toUpperCase()

    const exact = this.exact.get(`${upper} ${pathname}`)
    let found = exact ? { route: exact, values: [] } : null

    // A parameterised route registered earlier can still win over the
    // exact one, so the tree is checked unless the exact route came before
    // every parameterised route.
    if (!exact || exact.order > this.firstParamOrder) {
      const viaTree = this.find(this.tree, pathname.split('/'), 0, upper, [])
      if (viaTree && (!found || viaTree.route.order < found.route.order)) found = viaTree
    }
    if (!found) return null

    // decodeURIComponent throws URIError on a bad escape; Server.fail
    // turns that into a 400.
    const params = {}
    found.route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(found.values[i])
    })
    return { handler: this.chainOf(found.route), params, route: found.route }
  }
}
