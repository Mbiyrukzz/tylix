import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { TylixResponse, enhanceResponse } from './enhanceResponse.js'
import { requestContext } from '../observability/context.js'
import { logger as defaultLogger } from '../observability/logger.js'
import { metrics as defaultMetrics } from '../observability/metrics.js'
import { readBody } from './parseBody.js'
import { parseQuery } from './parseQuery.js'
import { parseCookies } from './parseCookies.js'
import { buildDebugPayload } from './debug/buildDebugPayload.js'
import { renderDebugPage } from './debug/renderDebugPage.js'
import { renderStatusPage } from './statusPage.js'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1 MB
const DEFAULT_PORT_ATTEMPTS = 10

// Pages inline their scripts, so script-src needs 'unsafe-inline'. The rest
// still blocks framing, base-tag and form hijacking, plugins, and data being
// sent to other origins. ws:/wss: is open because the channels server runs
// on its own port. Override the whole policy with CSP_POLICY if needed.
const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function originOf(value) {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

// Forwarding headers are only believed when the app is told it sits behind
// a proxy it controls, because any client can send X-Forwarded-For. The LAST
// hop is the one our own proxy appended, so a forged leading entry is ignored.
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]
  }
  return req.socket.remoteAddress || 'unknown'
}

function requestHost(req, trustProxy) {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-host'] || '') : ''
  const raw = forwarded ? forwarded.split(',').pop() : String(req.headers.host || '')
  return raw.trim().toLowerCase()
}

function isSecure(req, trustProxy) {
  if (req.socket.encrypted) return true
  if (!trustProxy) return false
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')
    .pop()
    .trim()
    .toLowerCase()
  return proto === 'https'
}

// A browser opening a page gets the HTML debug page. Everything else
// (fetch from useApi, curl, anything under /api/) gets JSON.
// Browsers send Sec-Fetch-Dest: document when you navigate (address bar,
// link click, reload). fetch()/useApi sends "empty", so API calls from
// the app keep getting JSON. Clients without the header (curl) fall
// back to the Accept check.
function pathOf(url) {
  const queryAt = String(url).indexOf('?')
  return queryAt === -1 ? String(url) : String(url).slice(0, queryAt)
}

// HTTP/1.1: a request has a body only when it says so with
// Content-Length or Transfer-Encoding.
function hasBody(req) {
  const length = req.headers['content-length']
  if (length !== undefined) return length !== '0'
  return req.headers['transfer-encoding'] !== undefined
}

// A client-sent X-Request-Id is kept (it ties the request to the
// caller's logs) when it looks like an id; otherwise a new one is made.
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
const QUIET_PATHS = new Set(['/health', '/ready', '/metrics'])

function requestIdOf(req) {
  const given = req.headers['x-request-id']
  return typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID()
}

// HTTP and process metrics, defined once per registry.
const httpMetricsByRegistry = new WeakMap()

function httpMetrics(registry) {
  let defined = httpMetricsByRegistry.get(registry)
  if (defined) return defined
  const loopDelay = monitorEventLoopDelay({ resolution: 20 })
  loopDelay.enable()
  defined = {
    requests: registry.counter('http_requests_total', 'HTTP requests by method, route and status'),
    duration: registry.histogram('http_request_duration_seconds', 'HTTP request duration by method and route'),
  }
  registry.gauge('process_resident_memory_bytes', 'Resident memory', () => process.memoryUsage.rss())
  registry.gauge('nodejs_heap_used_bytes', 'V8 heap in use', () => process.memoryUsage().heapUsed)
  registry.gauge('process_uptime_seconds', 'Seconds since the process started', () => Math.round(process.uptime()))
  registry.gauge('nodejs_eventloop_lag_p99_seconds', 'Event loop delay, 99th percentile', () => {
    const p99 = loopDelay.percentile(99) / 1e9
    loopDelay.reset()
    return p99
  })
  httpMetricsByRegistry.set(registry, defined)
  return defined
}

function wantsHtml(req) {
  if (req.method !== 'GET') return false
  const dest = req.headers['sec-fetch-dest']
  if (dest) return dest === 'document'
  const url = String(req.url).split('?')[0]
  return (
    !url.startsWith('/api/') &&
    String(req.headers.accept || '').includes('text/html')
  )
}

// The request's own path, for a "try again" link. Anything that isn't a
// plain same-site path ("//other.example" is a valid request line) goes
// to the home page instead.
function samePagePath(url) {
  const value = String(url ?? '/')
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/'
}

export class Server {
  constructor(
    router,
    {
      notFoundHandler = null,
      trustProxy,
      debug,
      maxBodyBytes,
      autoPort,
      maxPortAttempts,
      trustedOrigins,
      appUrl,
      cspMode,
      csp,
      logger,
      accessLog,
      slowRequestMs,
      metrics,
      compression,
    } = {},
  ) {
    this.router = router
    // Optional fallback called when no route matches, before the
    // default 404 JSON response -- e.g. tylix dev uses this to serve
    // static files from public/. Return true if it handled the
    // request (already wrote a response); false/undefined falls
    // through to the default 404.
    this.notFoundHandler = notFoundHandler
    // Believe X-Forwarded-For / X-Forwarded-Proto. Enable only behind a
    // proxy you control (nginx). Defaults to the TRUST_PROXY=true env var.
    this.trustProxy = trustProxy ?? process.env.TRUST_PROXY === 'true'
    this.production = process.env.NODE_ENV === 'production'
    // Show real error details (debug page, SQL, stack) instead of a
    // generic 500. Defaults to the APP_DEBUG=true env var.
    this.debug = debug ?? process.env.APP_DEBUG === 'true'
    // Largest request body accepted, in bytes. Bigger bodies get a 413.
    // Defaults to the MAX_BODY_BYTES env var, then 1 MB.
    this.maxBodyBytes =
      maxBodyBytes ??
      (Number(process.env.MAX_BODY_BYTES) || DEFAULT_MAX_BODY_BYTES)

    // When the port is already taken, try the next one instead of
    // crashing. On by default outside production (a proxy or process
    // manager expects a fixed port there). Override with AUTO_PORT=true
    // or AUTO_PORT=false.
    this.autoPort =
      autoPort ??
      (process.env.AUTO_PORT !== undefined
        ? process.env.AUTO_PORT === 'true'
        : !this.production)
    // How many following ports to try (PORT_ATTEMPTS, default 10).
    this.maxPortAttempts =
      maxPortAttempts ??
      (Number(process.env.PORT_ATTEMPTS) || DEFAULT_PORT_ATTEMPTS)

    // Origins allowed to make browser write requests from elsewhere
    // (TRUSTED_ORIGINS=https://a.example,https://b.example). APP_URL counts too.
    this.trustedOrigins = new Set(
      [...(trustedOrigins ?? parseList(process.env.TRUSTED_ORIGINS)), appUrl ?? process.env.APP_URL]
        .filter(Boolean)
        .map(originOf)
        .filter(Boolean),
    )

    // CSP_MODE: off | report-only | enforce. Production defaults to
    // report-only: violations show in the browser console, nothing breaks.
    this.cspMode = String(
      cspMode ?? (process.env.CSP_MODE || (this.production ? 'report-only' : 'off')),
    ).toLowerCase()
    this.csp = csp ?? (process.env.CSP_POLICY || DEFAULT_CSP)

    this.logger = logger ?? defaultLogger
    // One line per request: true, false, or "api" (only /api/ requests,
    // the development default, so asset and page requests stay quiet).
    this.accessLog = accessLog ?? (this.production ? true : 'api')
    // Requests slower than this are logged as warnings (0 turns it off).
    this.slowRequestMs = slowRequestMs ?? 1000
    // A metrics registry (or true for the shared one) to record HTTP
    // metrics in; off by default.
    this.metrics = metrics === true ? defaultMetrics : metrics || null
    this.httpMetrics = this.metrics ? httpMetrics(this.metrics) : null
    // Compress JSON responses of at least this many bytes (false: never).
    this.compressMinBytes = compression === false ? 0 : (compression?.minBytes ?? 1024)

    if (this.debug && this.production) {
      console.warn(
        '[tylix] APP_DEBUG is on while NODE_ENV=production. Error responses ' +
          'expose SQL, request data and stack traces. Set APP_DEBUG=false.',
      )
    }
  }

  createHandler() {
    return (req, res) => {
      const startedAt = performance.now()
      const requestId = requestIdOf(req)
      req.id = requestId
      res.setHeader('X-Request-Id', requestId)
      res.once('finish', () => this.finishRequest(req, res, startedAt))
      // Everything the request awaits runs inside its context, so logs
      // anywhere below carry its id.
      res.compressMinBytes = this.compressMinBytes
      return requestContext.run({ requestId, method: req.method, path: pathOf(req.url) }, async () => {
        enhanceResponse(res)
        try {
          await this.handle(req, res)
        } catch (err) {
          this.fail(req, res, err)
        }
      })
    }
  }

  // Access log, slow-request warning and metrics, once the response is sent.
  finishRequest(req, res, startedAt) {
    const durationMs = performance.now() - startedAt
    const path = pathOf(req.url)
    // The route's pattern, not the URL: /posts/:id stays one series.
    const route = req.route?.pattern ?? (res.statusCode === 404 ? 'not_found' : 'other')
    if (this.httpMetrics) {
      this.httpMetrics.requests.inc({ method: req.method, route, status: res.statusCode })
      this.httpMetrics.duration.observe(durationMs / 1000, { method: req.method, route })
    }
    const fields = { method: req.method, path, status: res.statusCode, ms: Math.round(durationMs), requestId: req.id }
    if (this.slowRequestMs > 0 && durationMs > this.slowRequestMs) {
      this.logger.warn('Slow request', { ...fields, route })
      return
    }
    // Health checks and metrics scrapes arrive every few seconds; logging
    // them would bury everything else.
    if (QUIET_PATHS.has(path)) return
    if (this.accessLog === true || (this.accessLog === 'api' && path.startsWith('/api/'))) {
      if (this.logger.isLevelEnabled('info')) this.logger.info(`${req.method} ${path} ${res.statusCode} ${fields.ms}ms`, this.production ? fields : undefined)
    }
  }

  applySecurityHeaders(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // allow-popups keeps OAuth and payment popups working.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')

    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    }

    if (this.cspMode === 'enforce') {
      res.setHeader('Content-Security-Policy', this.csp)
    } else if (this.cspMode === 'report-only') {
      res.setHeader('Content-Security-Policy-Report-Only', this.csp)
    }

    // API responses carry private data: never let a browser or proxy cache them.
    // Route handlers can still override this.
    if (String(req.url).startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store')
    }
  }

  // Browsers always label cross-origin requests (Sec-Fetch-Site / Origin), so
  // a browser write from another site is refused. Requests with neither header
  // (curl, webhooks, server-to-server) are not browser CSRF and pass through.
  isCrossSiteWrite(req) {
    if (!UNSAFE_METHODS.has(req.method)) return false

    const site = req.headers['sec-fetch-site']
    const origin = req.headers.origin
    if (!site && !origin) return false
    if (site === 'same-origin' || site === 'none') return false

    if (!origin) return true

    const parsed = originOf(origin)
    if (!parsed) return true
    if (this.trustedOrigins.has(parsed)) return false
    return new URL(parsed).host !== requestHost(req, this.trustProxy)
  }

  async handle(req, res) {
    req.ip = clientIp(req, this.trustProxy)
    req.secure = isSecure(req, this.trustProxy)

    this.applySecurityHeaders(req, res)

    if (this.isCrossSiteWrite(req)) {
      res.status(403).json({ error: 'Cross-site request blocked.' })
      return
    }

    let match = this.router.match(req.method, req.url)
    // HEAD is GET without a body; Node drops the body for us.
    if (!match && req.method === 'HEAD') {
      match = this.router.match('GET', req.url)
    }

    if (!match) {
      if (this.notFoundHandler) {
        const handled = await this.notFoundHandler(req, res)
        if (handled) return
      }
      if (wantsHtml(req)) {
        this.sendStatusPage(res, 404, {
          tone: 'notfound',
          code: '404',
          title: 'Page not found',
          message: "The page you're looking for doesn't exist or has been moved.",
        })
        return
      }
      res.status(404).json({ error: 'Not found' })
      return
    }

    req.params = match.params
    req.route = match.route
    req.query = parseQuery(req.url)
    req.cookies = parseCookies(req)

    // Nothing to read on a request without a body (most GETs): skip
    // waiting for the stream to end.
    if (!hasBody(req)) {
      req.rawBody = ''
      req.body = {}
      await match.handler(req, res)
      return
    }

    try {
      const { raw, body } = await readBody(req, { maxBytes: this.maxBodyBytes })
      // The exact text the client sent. Webhook signatures are computed
      // over these bytes, so they must not be re-serialised from req.body.
      req.rawBody = raw
      req.body = body
    } catch (err) {
      const status = err.status ?? 400
      // After an oversized upload, don't reuse the connection: the rest of
      // the body may still be on the wire.
      if (status === 413) res.setHeader('Connection', 'close')
      res.status(status).json({ error: err.message })
      return
    }

    await match.handler(req, res)
  }

  logFailure(req, err) {
    // Log the path only: query strings can carry tokens.
    const fields = { method: req.method, path: pathOf(req.url), requestId: req.id }

    if (err?.name === 'DatabaseError') {
      this.logger.error(`${err.title || 'Database error'} (${err.driver}/${err.kind})`, {
        ...fields,
        detail: err.message,
        ...(err.sql ? { sql: err.sql } : {}),
        ...(err.hint ? { fix: err.hint } : {}),
      })
    }

    this.logger.error(`${fields.method} ${fields.path} failed`, { ...fields, error: err })
  }

  sendDebug(req, res, err) {
    const payload = buildDebugPayload(err, req, { status: 500 })

    if (wantsHtml(req)) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(renderDebugPage(payload))
      return
    }

    // `error` stays a plain string so useApi and existing frontend code
    // keep working. The full detail travels in `debug`.
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({
      error: payload.title || payload.message,
      debug: payload,
    })
  }

  fail(req, res, err) {
    // A malformed %-escape in the URL is the client's fault, not a crash.
    const badRequest = err instanceof URIError

    if (!badRequest) this.logFailure(req, err)

    if (res.headersSent) {
      if (!res.writableEnded) res.end()
      return
    }

    if (badRequest) {
      if (wantsHtml(req)) {
        this.sendStatusPage(res, 400, {
          code: '400',
          title: 'Bad request',
          message: "The address of this page isn't valid. Check the link and try again.",
        })
        return
      }
      res.status(400).json({ error: 'Bad request' })
      return
    }

    if (this.debug) {
      try {
        this.sendDebug(req, res, err)
        return
      } catch (debugErr) {
        // The debug tooling must never be the reason a request hangs.
        console.error('[tylix] debug page failed:', debugErr)
      }
    }

    // A browser navigation gets a page, not JSON. The details stay in the
    // log; the page shows the request id to match it up.
    if (wantsHtml(req)) {
      this.sendStatusPage(res, 500, {
        code: '500',
        title: 'Something went wrong',
        message: 'The server hit an unexpected error. Please try again in a moment.',
        requestId: req.id,
        actions: [
          { label: 'Try again', href: samePagePath(req.url) },
          { label: 'Go home', href: '/' },
        ],
      })
      return
    }

    res.status(500).json({
      error: this.production ? 'Internal server error' : err.message,
    })
  }

  sendStatusPage(res, status, page) {
    res.statusCode = status
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(renderStatusPage(page))
  }

  // Starts listening on `port`. If that port is taken and autoPort is on,
  // tries port + 1, port + 2, ... up to maxPortAttempts times.
  //
  // `callback` receives the port actually bound, which may differ from
  // the one requested, so print THAT in your "running at" message.
  // Port 0 (let the OS pick) never retries.
  listen(port, callback) {
    const server = http.createServer({ ServerResponse: TylixResponse }, this.createHandler())
    const requested = Number(port)
    let attempt = 0

    const tryPort = (candidate) => {
      const onError = (err) => {
        const canRetry =
          err.code === 'EADDRINUSE' &&
          this.autoPort &&
          requested !== 0 &&
          attempt < this.maxPortAttempts

        if (canRetry) {
          attempt++
          console.warn(
            `[tylix] Port ${candidate} is already in use, trying ${candidate + 1}...`,
          )
          tryPort(candidate + 1)
          return
        }

        if (err.code === 'EADDRINUSE') {
          console.error(
            `[tylix] Port ${candidate} is already in use.` +
              (this.autoPort
                ? ` Tried ${attempt + 1} port(s) starting at ${requested}.`
                : ' Set AUTO_PORT=true to use the next free port, or change PORT.'),
          )
        }
        // Same behaviour as before: with no 'error' listener this throws.
        server.emit('error', err)
      }

      server.once('error', onError)
      server.listen(candidate, () => {
        server.removeListener('error', onError)
        const bound = server.address()
        const actual = typeof bound === 'object' && bound ? bound.port : candidate
        if (actual !== requested && requested !== 0) {
          console.warn(
            `[tylix] Listening on port ${actual} instead of ${requested}.`,
          )
        }
        if (callback) callback(actual)
      })
    }

    tryPort(requested)
    return server
  }
}