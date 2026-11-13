// ZIP archives (what .xlsx files are): writing with deflate and reading
// stored / deflated entries. Compression uses the platform's
// CompressionStream, so this runs in Node, Deno, Bun and browsers.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter()
  writer.write(bytes)
  writer.close()
  const chunks = []
  let size = 0
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

const canCompress = typeof CompressionStream === 'function'

export const deflateRaw = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'))
export const inflateRaw = (bytes) => {
  if (typeof DecompressionStream !== 'function') throw new Error('This runtime has no DecompressionStream')
  return pipe(bytes, new DecompressionStream('deflate-raw'))
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return [time & 0xffff, day & 0xffff]
}

// entries: [{ name, data: Uint8Array | string }] -> zip bytes.
export async function writeZip(entries, { date = new Date(), compress = true } = {}) {
  const [time, day] = dosDateTime(date)
  const files = await Promise.all(
    entries.map(async ({ name, data }) => {
      const raw = typeof data === 'string' ? encoder.encode(data) : data
      let body = raw
      let method = 0
      if (compress && canCompress && raw.length > 64) {
        const packed = await deflateRaw(raw)
        if (packed.length < raw.length) {
          body = packed
          method = 8
        }
      }
      return { name: encoder.encode(name), raw, body, method, crc: crc32(raw) }
    }),
  )
  let size = 0
  for (const f of files) size += 30 + f.name.length + f.body.length + 46 + f.name.length
  size += 22
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let p = 0
  const offsets = []
  for (const f of files) {
    offsets.push(p)
    view.setUint32(p, 0x04034b50, true)
    view.setUint16(p + 4, 20, true)
    view.setUint16(p + 6, 0x0800, true) // UTF-8 names
    view.setUint16(p + 8, f.method, true)
    view.setUint16(p + 10, time, true)
    view.setUint16(p + 12, day, true)
    view.setUint32(p + 14, f.crc, true)
    view.setUint32(p + 18, f.body.length, true)
    view.setUint32(p + 22, f.raw.length, true)
    view.setUint16(p + 26, f.name.length, true)
    view.setUint16(p + 28, 0, true)
    out.set(f.name, p + 30)
    out.set(f.body, p + 30 + f.name.length)
    p += 30 + f.name.length + f.body.length
  }
  const cdStart = p
  files.forEach((f, i) => {
    view.setUint32(p, 0x02014b50, true)
    view.setUint16(p + 4, 20, true)
    view.setUint16(p + 6, 20, true)
    view.setUint16(p + 8, 0x0800, true)
    view.setUint16(p + 10, f.method, true)
    view.setUint16(p + 12, time, true)
    view.setUint16(p + 14, day, true)
    view.setUint32(p + 16, f.crc, true)
    view.setUint32(p + 20, f.body.length, true)
    view.setUint32(p + 24, f.raw.length, true)
    view.setUint16(p + 28, f.name.length, true)
    view.setUint32(p + 42, offsets[i], true)
    out.set(f.name, p + 46)
    p += 46 + f.name.length
  })
  view.setUint32(p, 0x06054b50, true)
  view.setUint16(p + 8, files.length, true)
  view.setUint16(p + 10, files.length, true)
  view.setUint32(p + 12, p - cdStart, true)
  view.setUint32(p + 16, cdStart, true)
  return out
}

// zip bytes -> Map(name -> { read(): Promise<Uint8Array>, text(): Promise<string> }).
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP directory found)')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory')
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    const localNameLen = view.getUint16(local + 26, true)
    const localExtra = view.getUint16(local + 28, true)
    const start = local + 30 + localNameLen + localExtra
    const data = bytes.subarray(start, start + compSize)
    let cached
    const read = () => {
      if (!cached) {
        if (method === 0) cached = Promise.resolve(data)
        else if (method === 8) cached = inflateRaw(data)
        else cached = Promise.reject(new Error(`Unsupported ZIP compression method ${method} for ${name}`))
      }
      return cached
    }
    entries.set(name, { read, text: async () => decoder.decode(await read()) })
  }
  return entries
}
