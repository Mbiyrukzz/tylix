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

export function enhanceResponse(res) {
  res.status = function (code) {
    res.statusCode = code
    return res
  }

  res.json = function (data) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
    return res
  }

  res.send = function (data) {
    if (data === undefined) {
      res.end()
      return res
    }
    res.end(typeof data === 'string' ? data : JSON.stringify(data))
    return res
  }

  // Set-Cookie can legitimately appear more than once (access + refresh
  // tokens in the same response), so this appends rather than overwrites.
  res.cookie = function (name, value, options = {}) {
    const serialized = serializeCookie(name, value, options)
    const existing = res.getHeader('Set-Cookie')
    const cookies = existing
      ? Array.isArray(existing)
        ? existing.slice()
        : [existing]
      : []
    cookies.push(serialized)
    res.setHeader('Set-Cookie', cookies)
    return res
  }

  res.clearCookie = function (name, options = {}) {
    res.cookie(name, '', { ...options, maxAge: 0, expires: new Date(0) })
    return res
  }

  return res
}
