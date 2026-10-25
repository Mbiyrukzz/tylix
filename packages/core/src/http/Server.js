import http from 'node:http'
import { enhanceResponse } from './enhanceResponse.js'
import { readBody } from './parseBody.js'
import { parseQuery } from './parseQuery.js'
import { parseCookies } from './parseCookies.js'
import { buildDebugPayload } from './debug/buildDebugPayload.js'
import { renderDebugPage } from './debug/renderDebugPage.js'

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

export class Server {
  constructor(router, { notFoundHandler = null, trustProxy, debug } = {}) {
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

    if (this.debug && this.production) {
      console.warn(
        '[tylix] APP_DEBUG is on while NODE_ENV=production. Error responses ' +
          'expose SQL, request data and stack traces. Set APP_DEBUG=false.',
      )
    }
  }

  createHandler() {
    return async (req, res) => {
      enhanceResponse(res)
      try {
        await this.handle(req, res)
      } catch (err) {
        this.fail(req, res, err)
      }
    }
  }

  async handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

    req.ip = clientIp(req, this.trustProxy)
    req.secure = isSecure(req, this.trustProxy)

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
      res.status(404).json({ error: 'Not found' })
      return
    }

    req.params = match.params
    req.query = parseQuery(req.url)
    req.cookies = parseCookies(req)

    try {
      const { raw, body } = await readBody(req)
      // The exact text the client sent. Webhook signatures are computed
      // over these bytes, so they must not be re-serialised from req.body.
      req.rawBody = raw
      req.body = body
    } catch (err) {
      res.status(400).json({ error: err.message })
      return
    }

    await match.handler(req, res)
  }

  logFailure(req, err) {
    // Log the path only: query strings can carry tokens.
    const where = `${req.method} ${String(req.url).split('?')[0]}`

    if (err?.name === 'DatabaseError') {
      const lines = [
        `[tylix] ${where} failed: ${err.title || 'Database error'}` +
          ` (${err.driver}/${err.kind})`,
        `  ${err.message}`,
      ]
      if (err.sql) lines.push(`  SQL: ${err.sql}`)
      if (err.hint) lines.push(`  Fix: ${err.hint}`)
      console.error(lines.join('\n'))
    }

    console.error(`[tylix] ${where} failed:`, err)
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

    res.status(500).json({
      error: this.production ? 'Internal server error' : err.message,
    })
  }

  listen(port, callback) {
    const server = http.createServer(this.createHandler())
    return server.listen(port, callback)
  }
}