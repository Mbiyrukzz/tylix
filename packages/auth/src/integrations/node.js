import { applyCookies } from '../http/request.js'
import { handleAuthRoute } from './routes.js'

// Express / Connect / plain node:http, Fastify and Koa.
//
// Express:
//   app.use(expressAuth(auth))                 // req.auth: session or null; serves /api/auth/*
//   app.get('/api/me', requireExpressAuth(), (req, res) => res.json({ id: req.auth.userId }))
//   // login: const { cookies } = await auth.signIn(req, user.id); applyCookies(res, cookies)
//
// Fastify:
//   fastifyAuth(app, auth)                     // request.auth + /api/auth/* routes
//
// Koa:
//   app.use(koaAuth(auth))                     // ctx.state.auth + /api/auth/* routes

function send(res, { status, body, cookies }) {
  applyCookies(res, cookies)
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  if (body == null) return res.end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function expressAuth(auth, options = {}) {
  return async function authMiddleware(req, res, next) {
    try {
      const result = await handleAuthRoute(auth, req, options)
      if (result) return send(res, result)
      req.auth = await auth.getSession(req)
      next()
    } catch (error) {
      next(error)
    }
  }
}

/** 401s requests without a session. Use after expressAuth(). */
export function requireExpressAuth() {
  return function requireAuth(req, res, next) {
    if (req.auth) return next()
    send(res, { status: 401, body: { error: 'Not authenticated.' }, cookies: [] })
  }
}

export function fastifyAuth(app, auth, options = {}) {
  const basePath = (options.basePath ?? '/api/auth').replace(/\/+$/, '')
  app.decorateRequest?.('auth', null)
  app.addHook('preHandler', async (request) => {
    request.auth = await auth.getSession(request)
  })
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: `${basePath}/*`,
    handler: async (request, reply) => {
      const result = (await handleAuthRoute(auth, request, options)) ?? { status: 404, body: { error: 'Not found.' }, cookies: [] }
      applyCookies(reply, result.cookies)
      reply.header('Cache-Control', 'no-store')
      reply.code(result.status)
      return result.body == null ? reply.send() : reply.send(result.body)
    },
  })
}

export function requireFastifyAuth() {
  return async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Not authenticated.' })
  }
}

export function koaAuth(auth, options = {}) {
  return async function authMiddleware(ctx, next) {
    const result = await handleAuthRoute(auth, ctx, options)
    if (result) {
      applyCookies(ctx, result.cookies)
      ctx.set('Cache-Control', 'no-store')
      ctx.status = result.status
      if (result.body != null) ctx.body = result.body
      return
    }
    ctx.state.auth = await auth.getSession(ctx)
    await next()
  }
}

export { applyCookies } from '../http/request.js'
