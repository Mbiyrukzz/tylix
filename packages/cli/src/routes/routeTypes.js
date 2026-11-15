// Builds a typed API client from the routes the app registers.
//
//   import { routes } from './api.generated'
//   const posts = await routes.posts.index({ query: { page: 2 } })
//   const post = await routes.posts.show({ id: 7 })
//   await routes.posts.update({ id: 7 }, { title: 'New' })
//   await routes.login({ email, password })
//
// Feature routes (make:feature) get their model's fields as types; auth
// routes get their request bodies; anything else is typed by its method
// and path parameters, with `unknown` data.

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const IDENT = /^[A-Za-z_$][\w$]*$/

// Routes a client never calls: dev tools and operations endpoints.
const SKIP = [/^\/api\/_tylix\//, /^\/(health|ready|metrics)$/]

const camel = (segment) =>
  segment
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
    .replace(/^(\d)/, '_$1')

const pascal = (text) => camel(text).replace(/^[a-z]/, (c) => c.toUpperCase())

export function paramNames(pattern) {
  return [...pattern.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1])
}

// "/api/auth/sessions/:id" -> ["auth", "sessions"]
function namePath(pattern) {
  return pattern
    .split('/')
    .filter((s) => s && !s.startsWith(':') && s !== '*')
    .filter((s, i) => !(i === 0 && s === 'api'))
    .map(camel)
}

const RESOURCE_ACTION = {
  GET: (trailingParam) => (trailingParam ? 'show' : 'index'),
  POST: () => 'store',
  PUT: () => 'update',
  PATCH: () => 'update',
  DELETE: () => 'destroy',
}

// Gives every route a dotted name, e.g. posts.show, auth.refresh, me.
// A path with one route is a function at that path; a path with several
// (or with routes below it) gets resource names: index, show, store,
// update, destroy.
export function nameRoutes(routes) {
  const byPath = new Map()
  for (const route of routes) {
    const key = namePath(route.pattern).join('.') || 'root'
    if (!byPath.has(key)) byPath.set(key, [])
    byPath.get(key).push(route)
  }
  const keys = [...byPath.keys()]
  const named = []
  for (const [key, group] of byPath) {
    const hasChildren = keys.some((other) => other.startsWith(`${key}.`))
    if (group.length === 1 && !hasChildren) {
      named.push({ ...group[0], name: key })
      continue
    }
    const used = new Set()
    for (const route of group) {
      const trailingParam = /\/:[^/]+$/.test(route.pattern)
      let action = RESOURCE_ACTION[route.method]?.(trailingParam) ?? route.method.toLowerCase()
      if (used.has(action)) action = `${action}${pascal(route.method.toLowerCase())}${trailingParam ? 'ById' : ''}`
      let unique = action
      for (let n = 2; used.has(unique); n++) unique = `${action}${n}`
      used.add(unique)
      named.push({ ...route, name: `${key}.${unique}` })
    }
  }
  return named
}

const FIELD_TYPES = {
  string: 'string',
  text: 'string',
  mediumText: 'string',
  longText: 'string',
  date: 'string',
  datetime: 'string',
  integer: 'number',
  float: 'number',
  increments: 'number',
  boolean: 'boolean',
  json: 'unknown',
}

const key = (name) => (IDENT.test(name) ? name : JSON.stringify(name))

function modelInterface(manifest) {
  const name = pascal(manifest.model ?? manifest.name)
  const fields = manifest.fields ?? []
  const lines = [`  id: number`]
  for (const field of fields) lines.push(`  ${key(field.name)}: ${FIELD_TYPES[field.type] ?? 'unknown'} | null`)
  if (manifest.timestamps !== false) lines.push('  created_at: string', '  updated_at: string')
  const input = fields.filter((f) => !f.system).map((f) => `  ${key(f.name)}?: ${FIELD_TYPES[f.type] ?? 'unknown'} | null`)
  return [
    `export interface ${name} {\n${lines.join('\n')}\n}`,
    `export interface ${name}Input {\n${input.join('\n')}${input.length ? '\n' : ''}}`,
  ].join('\n\n')
}

const AUTH_BODIES = {
  'POST /api/login': '{ email: string; password: string; remember?: boolean }',
  'POST /api/register': '{ name: string; email: string; password: string }',
  'POST /api/auth/forgot-password': '{ email: string }',
  'POST /api/auth/reset-password': '{ email: string; token: string; password: string }',
  'POST /api/auth/verify-email': '{ token: string }',
  'POST /api/auth/resend-verification': '{ email?: string }',
  'POST /api/auth/change-password': '{ currentPassword: string; password: string }',
}
const AUTH_RESPONSES = {
  'GET /api/me': '{ user: AuthUser }',
  'POST /api/login': '{ user: AuthUser }',
  'POST /api/register': '{ user: AuthUser }',
}

// The request body and response types of one route.
function routeTypes(route, featuresByBase) {
  const id = `${route.method} ${route.pattern}`
  const feature = route.source === 'feature' ? featuresByBase.get(route.pattern.replace(/\/:[^/]+$/, '')) : null
  if (feature) {
    const model = pascal(feature.model ?? feature.name)
    const trailingParam = /\/:[^/]+$/.test(route.pattern)
    switch (route.method) {
      case 'GET':
        return trailingParam
          ? { response: `{ data: ${model} }` }
          : { response: `Paginated<${model}>`, query: `{ page?: number; limit?: number; [filter: string]: string | number | undefined }` }
      case 'POST':
        return { body: `${model}Input`, response: `{ data: ${model} }` }
      case 'PUT':
      case 'PATCH':
        return { body: `${model}Input`, response: `{ data: ${model} }` }
      case 'DELETE':
        return { response: 'null' }
    }
  }
  return {
    body: AUTH_BODIES[id] ?? (BODY_METHODS.has(route.method) ? 'Record<string, unknown>' : undefined),
    response: AUTH_RESPONSES[id] ?? 'unknown',
  }
}

function paramsType(params) {
  return params.length ? `{ ${params.map((p) => `${key(p)}: string | number`).join('; ')} }` : 'Record<string, never>'
}

// Nests "a.b.c" names into an object tree.
function tree(named, leaf) {
  const root = {}
  for (const route of named) {
    const parts = route.name.split('.')
    let node = root
    for (const part of parts.slice(0, -1)) node = node[part] ??= {}
    node[parts.at(-1)] = leaf(route)
  }
  return root
}

function printTree(node, indent, print) {
  const pad = '  '.repeat(indent)
  return Object.entries(node)
    .map(([name, value]) => (typeof value === 'object' && !Array.isArray(value) && !value.__leaf ? `${pad}${key(name)}: {\n${printTree(value, indent + 1, print)}\n${pad}}` : `${pad}${key(name)}${print(value)}`))
    .join(print.separator ?? '\n')
}

export const GENERATED_HEADER = '// Generated by "tylix routes:types" from the app\'s routes. Do not edit:\n// it is rewritten when the routes change (tylix dev does it on start).\n'

// Returns { ts, js, dts }: the TypeScript client, or a JavaScript client
// with its declaration file.
export function generateRouteClient({ routes, features = [] }) {
  const usable = routes.filter((r) => r.pattern.startsWith('/') && !r.pattern.includes('*') && !SKIP.some((re) => re.test(r.pattern)))
  // One entry per method + path: the router answers with the first.
  const unique = [...new Map(usable.map((r) => [`${r.method} ${r.pattern}`, r])).values()]
    .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS')
    .sort((a, b) => a.pattern.localeCompare(b.pattern) || a.method.localeCompare(b.method))
  const named = nameRoutes(unique)

  const manifests = features.map((f) => f.manifest ?? f).filter((m) => m?.table)
  const featuresByBase = new Map(manifests.map((m) => [`/api/${m.table}`, m]))
  const usedFeatures = manifests.filter((m) => named.some((r) => r.source === 'feature' && r.pattern.replace(/\/:[^/]+$/, '') === `/api/${m.table}`))
  const auth = named.some((r) => r.pattern === '/api/me' || r.pattern === '/api/login')

  const typed = named.map((r) => ({ ...r, params: paramNames(r.pattern), ...routeTypes(r, featuresByBase) }))

  const models = [
    `export interface Paginated<T> {\n  data: T[]\n  meta: { page: number; limit: number; total: number; totalPages: number }\n}`,
    ...(auth ? [`export interface AuthUser {\n  id: number | string\n  name?: string\n  email: string\n  [key: string]: unknown\n}`] : []),
    ...usedFeatures.map(modelInterface),
  ].join('\n\n')

  const routeMap = typed
    .map((r) => {
      const fields = [
        `params: ${paramsType(r.params)}`,
        `query: ${r.query ?? 'Record<string, string | number | boolean | undefined>'}`,
        `body: ${r.body ?? 'undefined'}`,
        `response: ${r.response}`,
        `auth: ${r.auth ? 'true' : 'false'}`,
      ]
      return `  ${JSON.stringify(`${r.method} ${r.pattern}`)}: {\n    ${fields.join('\n    ')}\n  }`
    })
    .join('\n')

  const signature = (r) => {
    const args = []
    if (r.params.length) args.push(`params: ApiRoutes[${JSON.stringify(`${r.method} ${r.pattern}`)}]['params']`)
    if (r.body) args.push(`body${r.body === 'Record<string, unknown>' ? '?' : ''}: ApiRoutes[${JSON.stringify(`${r.method} ${r.pattern}`)}]['body']`)
    args.push(`options?: RouteOptions<ApiRoutes[${JSON.stringify(`${r.method} ${r.pattern}`)}]['query']>`)
    return `(${args.join(', ')}): Promise<ApiResult<ApiRoutes[${JSON.stringify(`${r.method} ${r.pattern}`)}]['response']>>`
  }
  const leafTree = tree(typed, (r) => ({ __leaf: true, route: r }))
  const clientType = printTree(leafTree, 1, (leaf) => signature(leaf.route))
  const tableTree = printTree(tree(typed, (r) => ({ __leaf: true, route: r })), 1, Object.assign((leaf) => `: [${JSON.stringify(leaf.route.method)}, ${JSON.stringify(leaf.route.pattern)}]`, { separator: ',\n' }))

  const types = `${models}

export interface RouteOptions<Q = Record<string, unknown>> {
  query?: Q
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number
}

// Every route: "METHOD /path" -> its params, query, body and response.
export interface ApiRoutes {
${routeMap}
}

export interface RouteClient {
${clientType}
  /** Any route by "METHOD /path". */
  $request<K extends keyof ApiRoutes>(
    route: K,
    input?: { params?: ApiRoutes[K]['params']; query?: ApiRoutes[K]['query']; body?: ApiRoutes[K]['body'] } & Omit<RouteOptions, 'query'>,
  ): Promise<ApiResult<ApiRoutes[K]['response']>>
}
`

  const table = `{\n${tableTree}\n}`
  const ts = `${GENERATED_HEADER}import { api, createRouteClient } from '@tylix/client'
import type { ApiResult } from '@tylix/client'

${types}
export const routes = createRouteClient(api, ${table}) as unknown as RouteClient
`
  const js = `${GENERATED_HEADER}import { api, createRouteClient } from '@tylix/client'

/** @type {import('./api.generated').RouteClient} */
export const routes = createRouteClient(api, ${table})
`
  const dts = `${GENERATED_HEADER}import type { ApiResult } from '@tylix/client'

${types}
export declare const routes: RouteClient
`
  return { ts, js, dts, routes: typed }
}
