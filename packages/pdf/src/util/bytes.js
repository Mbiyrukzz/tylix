// Byte helpers that work the same in Node and browsers (Uint8Array only).

const encoder = new TextEncoder()

export function utf8(text) {
  return encoder.encode(text)
}

// One byte per char (chars above 255 must already be encoded away).
export function latin1(text) {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

export function concat(chunks) {
  let size = 0
  for (const c of chunks) size += c.length
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  if (Array.isArray(input)) return Uint8Array.from(input)
  throw new TypeError('Expected bytes (Uint8Array, Buffer or ArrayBuffer)')
}

// Growable byte buffer used to serialize the PDF.
export class ByteWriter {
  constructor() {
    this.chunks = []
    this.length = 0
  }

  write(data) {
    const bytes = typeof data === 'string' ? latin1(data) : data
    this.chunks.push(bytes)
    this.length += bytes.length
  }

  bytes() {
    return concat(this.chunks)
  }
}

export function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:')
}

export function decodeDataUrl(url) {
  const comma = url.indexOf(',')
  const meta = url.slice(5, comma)
  const body = url.slice(comma + 1)
  if (meta.endsWith(';base64')) return base64Decode(body)
  return utf8(decodeURIComponent(body))
}

export function base64Decode(text) {
  if (typeof atob === 'function') {
    const bin = atob(text.replace(/\s+/g, ''))
    return latin1(bin)
  }
  return new Uint8Array(Buffer.from(text, 'base64'))
}

export function hex(bytes) {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function readU16(b, o) {
  return (b[o] << 8) | b[o + 1]
}

export function readI16(b, o) {
  const v = readU16(b, o)
  return v & 0x8000 ? v - 0x10000 : v
}

export function readU32(b, o) {
  return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
}
