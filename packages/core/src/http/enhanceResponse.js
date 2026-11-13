import http from 'node:http'
import zlib from 'node:zlib'

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`)
  }
  parts.push(`Path=${options.path || '/'}`)
  if (options.domain) {
    parts.push(`Domain=${options.domain}`)
  }
  if (options.httpOnly !== false) {
    parts.push('HttpOnly')
  }
  if (options.secure) {
    parts.push('Secure')
  }
  parts.push(`SameSite=${options.sameSite || 'Lax'}`)

  return parts.join('; ')
}

// The response helpers (res.status, res.json, res.send, res.cookie,
// res.clearCookie). The Tylix server defines them once on its response
// class; enhanceResponse() adds them to any other response object.
// JSON bodies at least this big are compressed when the client accepts
// it (the server turns this on per response; see Server's compression).
// Brotli at a low quality and gzip at level 5 compress well at a small
// CPU cost, since this runs on every such response.
function compress(res, text) {
  const minBytes = res.compressMinBytes
  if (!minBytes || text.length < minBytes || res.getHeader('Content-Encoding')) return null
  const accepted = String(res.req?.headers['accept-encoding'] ?? '')
  res.setHeader('Vary', 'Accept-Encoding')
  if (/\bbr\b/.test(accepted)) {
    return {
      encoding: 'br',
      body: zlib.brotliCompressSync(text, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: text.length },
      }),
    }
  }
  if (/\bgzip\b/.test(accepted)) return { encoding: 'gzip', body: zlib.gzipSync(text, { level: 5 }) }
  return null
}

const helpers = {
  status(code) {
    this.statusCode = code
    return this
  },

  // Sent with a Content-Length, so Node needn't fall back to chunked
  // encoding.
  json(data) {
    const text = JSON.stringify(data)
    this.setHeader('Content-Type', 'application/json')
    if (text === undefined) {
      this.end()
      return this
    }
    const compressed = compress(this, text)
    if (compressed) {
      this.setHeader('Content-Encoding', compressed.encoding)
      this.setHeader('Content-Length', compressed.body.length)
      this.end(this.req?.method === 'HEAD' ? undefined : compressed.body)
      return this
    }
    this.setHeader('Content-Length', Buffer.byteLength(text))
    this.end(text)
    return this
  },

  send(data) {
    if (data === undefined) {
      this.end()
      return this
    }
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
      this.end(data)
      return this
    }
    // Objects, numbers, booleans: send as JSON with the right Content-Type.
    return this.json(data)
  },

  // Set-Cookie can legitimately appear more than once (access + refresh
  // tokens in the same response), so this appends rather than overwrites.
  // Secure defaults to on for HTTPS requests and in production, and is
  // forced on for SameSite=None (browsers reject it otherwise). Pass
  // secure: false explicitly to opt out.
  cookie(name, value, options = {}) {
    const secureByDefault =
      Boolean(this.req && this.req.secure) || process.env.NODE_ENV === 'production' || options.sameSite === 'None'
    const serialized = serializeCookie(name, value, {
      ...options,
      secure: options.secure ?? secureByDefault,
    })
    const existing = this.getHeader('Set-Cookie')
    const cookies = existing ? (Array.isArray(existing) ? existing.slice() : [existing]) : []
    cookies.push(serialized)
    this.setHeader('Set-Cookie', cookies)
    return this
  },

  clearCookie(name, options = {}) {
    this.cookie(name, '', { ...options, maxAge: 0, expires: new Date(0) })
    return this
  },
}

// The response class the Tylix server creates its responses with.
export class TylixResponse extends http.ServerResponse {}
Object.assign(TylixResponse.prototype, helpers)

export function enhanceResponse(res) {
  if (res instanceof TylixResponse) return res
  for (const [name, fn] of Object.entries(helpers)) res[name] = fn.bind(res)
  return res
}
