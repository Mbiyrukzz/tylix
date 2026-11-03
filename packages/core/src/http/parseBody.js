const DEFAULT_MAX_BYTES = 1024 * 1024 // 1 MB

function isJson(contentType) {
  const type = String(contentType).split(';')[0].trim().toLowerCase()
  return type === 'application/json' || type.endsWith('+json')
}

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * Reads the whole request body once.
 * Returns { raw, body }: raw is the exact UTF-8 text the client sent,
 * body is the parsed JSON (or {} for empty or non-JSON bodies).
 *
 * Chunks are collected as Buffers and decoded once at the end. Joining
 * them as strings can split a multi-byte character across two chunks,
 * which would change the text and break webhook signature checks.
 *
 * Bodies larger than `maxBytes` (default 1 MB) are rejected with an error
 * whose `status` is 413. Invalid JSON is rejected with status 400.
 */
export function readBody(req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false

    // Reject early when the client announces a size that is already too big.
    const declared = Number(req.headers['content-length'])
    if (declared > maxBytes) {
      req.resume() // drain so the response can still be sent
      return reject(httpError('Request body too large', 413))
    }

    req.on('data', (chunk) => {
      if (tooLarge) return // keep draining, stop buffering
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buf.length
      if (size > maxBytes) {
        tooLarge = true
        chunks.length = 0
        reject(httpError('Request body too large', 413))
        return
      }
      chunks.push(buf)
    })

    req.on('end', () => {
      if (tooLarge) return
      const raw = Buffer.concat(chunks).toString('utf8')

      if (!raw) return resolve({ raw: '', body: {} })

      if (!isJson(req.headers['content-type'] || '')) {
        return resolve({ raw, body: {} })
      }

      try {
        resolve({ raw, body: JSON.parse(raw) })
      } catch {
        reject(httpError('Invalid JSON body', 400))
      }
    })

    req.on('error', reject)
  })
}

export async function parseBody(req, options) {
  const { body } = await readBody(req, options)
  return body
}