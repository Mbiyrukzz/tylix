// Bytes from bytes, data: URLs, http(s) URLs, Blobs or file paths.

export function isBytes(v) {
  return v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}

function toBytes(v) {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}

export async function loadSource(src, basePath) {
  if (isBytes(src)) return toBytes(src)
  if (src && typeof src.arrayBuffer === 'function') return new Uint8Array(await src.arrayBuffer())
  if (typeof src !== 'string') throw new TypeError('Expected bytes, a Blob, a data: URL, a URL or a file path')
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',')
    const body = src.slice(comma + 1)
    if (src.slice(0, comma).endsWith(';base64')) {
      if (globalThis.Buffer) return new Uint8Array(globalThis.Buffer.from(body, 'base64'))
      const bin = atob(body)
      return Uint8Array.from(bin, (c) => c.charCodeAt(0))
    }
    return new TextEncoder().encode(decodeURIComponent(body))
  }
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`Couldn't load ${src}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  let fs
  let path
  try {
    fs = await import('node:fs/promises')
    path = await import('node:path')
  } catch {
    throw new Error(`Can't read the file "${src}" here: pass bytes, a Blob or a URL`)
  }
  const full = basePath ? path.resolve(basePath, src) : src
  try {
    return new Uint8Array(await fs.readFile(full))
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`File not found: ${full}`)
    throw err
  }
}
