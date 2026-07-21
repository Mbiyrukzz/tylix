import http from 'node:http'
import { enhanceResponse } from './enhanceResponse.js'
import { parseBody } from './parseBody.js'
import { parseQuery } from './parseQuery.js'
import { parseCookies } from './parseCookies.js'

export class Server {
  constructor(router, { notFoundHandler = null } = {}) {
    this.router = router
    // Optional fallback called when no route matches, before the
    // default 404 JSON response -- e.g. tylix dev uses this to serve
    // static files from public/. Return true if it handled the
    // request (already wrote a response); false/undefined falls
    // through to the default 404.
    this.notFoundHandler = notFoundHandler
  }

  createHandler() {
    return async (req, res) => {
      enhanceResponse(res)

      const match = this.router.match(req.method, req.url)
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
        req.body = await parseBody(req)
      } catch (err) {
        res.status(400).json({ error: err.message })
        return
      }

      try {
        await match.handler(req, res)
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    }
  }

  listen(port, callback) {
    const server = http.createServer(this.createHandler())
    return server.listen(port, callback)
  }
}
