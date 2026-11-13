// Loading fonts and images from bytes, data: URLs, http(s) URLs or file
// paths (Node, Deno, Bun). Paths are resolved against `basePath`.

import { toBytes, isDataUrl, decodeDataUrl } from './util/bytes.js'
import { openImage } from './images/PdfImage.js'

export function isBytes(v) {
  return v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}

export async function loadSource(src, basePath) {
  if (isBytes(src)) return toBytes(src)
  if (typeof src !== 'string') {
    if (src && typeof src.arrayBuffer === 'function') return new Uint8Array(await src.arrayBuffer()) // Blob / File / Response
    throw new TypeError('Expected bytes, a data: URL, a URL or a file path')
  }
  if (isDataUrl(src)) return decodeDataUrl(src)
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
    throw new Error(`Can't read the file "${src}" here: pass bytes, a data: URL or an http(s) URL`)
  }
  const full = basePath ? path.resolve(basePath, src) : src
  try {
    return new Uint8Array(await fs.readFile(full))
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`File not found: ${full}`)
    throw err
  }
}

// Images by source: bytes and data URLs open on demand; paths and URLs
// must be preloaded (the document does that for every { image } it
// finds, plus anything in `images`).
export class ImageStore {
  constructor() {
    this.byKey = new Map()
    this.byBytes = new WeakMap()
    this.tracked = new Set()
  }

  set(key, bytes) {
    const img = openImage(bytes)
    this.byKey.set(key, img)
    return img
  }

  has(key) {
    return this.byKey.has(key)
  }

  get(src) {
    if (src && typeof src === 'object' && src.embed) return this.track(src)
    if (isBytes(src)) {
      const bytes = toBytes(src)
      let img = this.byBytes.get(bytes.buffer)
      if (!img || img.bytes.byteOffset !== bytes.byteOffset) {
        img = openImage(bytes)
        this.byBytes.set(bytes.buffer, img)
      }
      return this.track(img)
    }
    if (typeof src === 'string') {
      const hit = this.byKey.get(src)
      if (hit) return this.track(hit)
      if (isDataUrl(src)) return this.track(this.set(src, decodeDataUrl(src)))
      throw new Error(`Image "${src}" isn't loaded. List it in the document's images: { name: source }, or pass bytes.`)
    }
    throw new TypeError('Invalid image source')
  }

  track(img) {
    this.tracked.add(img)
    return img
  }

  all() {
    return [...this.tracked]
  }
}
