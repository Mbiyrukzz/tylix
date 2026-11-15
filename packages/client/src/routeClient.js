// The runtime behind the typed client "tylix routes:types" writes. It
// turns a table of names -> [method, pattern] into functions:
//
//   const routes = createRouteClient(api, { posts: { show: ['GET', '/api/posts/:id'] } })
//   await routes.posts.show({ id: 7 }, { query: { include: 'author' } })
//
// Arguments, in order: path params (when the pattern has any), the body
// (POST, PUT, PATCH), then options ({ query, headers, signal, timeout }).

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

function paramNames(pattern) {
  return [...pattern.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1])
}

export function buildPath(pattern, params = {}, query) {
  const missing = []
  let url = pattern.replace(/:([A-Za-z_]\w*)/g, (_, name) => {
    const value = params?.[name]
    if (value === undefined || value === null || value === '') {
      missing.push(name)
      return ''
    }
    return encodeURIComponent(String(value))
  })
  if (missing.length) throw new Error(`[tylix] ${pattern} needs ${missing.map((m) => `"${m}"`).join(', ')}.`)
  if (query && typeof query === 'object') {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) for (const item of value) search.append(key, String(item))
      else search.append(key, String(value))
    }
    const text = search.toString()
    if (text) url += `?${text}`
  }
  return url
}

function call(api, method, pattern, { params, body, query, ...options } = {}) {
  const url = buildPath(pattern, params, query)
  return api(url, { ...options, method, ...(BODY_METHODS.has(method) && body !== undefined ? { body } : {}) })
}

function routeFunction(api, method, pattern) {
  const hasParams = paramNames(pattern).length > 0
  const hasBody = BODY_METHODS.has(method)
  return (...args) => {
    const params = hasParams ? args.shift() : undefined
    const body = hasBody ? args.shift() : undefined
    const options = args.shift() ?? {}
    return call(api, method, pattern, { ...options, params, body })
  }
}

function build(api, table) {
  const out = {}
  for (const [name, value] of Object.entries(table)) {
    out[name] = Array.isArray(value) ? routeFunction(api, value[0], value[1]) : build(api, value)
  }
  return out
}

export function createRouteClient(api, table) {
  const client = build(api, table)
  client.$request = (route, input = {}) => {
    const at = route.indexOf(' ')
    return call(api, route.slice(0, at).toUpperCase(), route.slice(at + 1), input)
  }
  return client
}
