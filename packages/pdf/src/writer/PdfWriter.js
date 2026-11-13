// Collects indirect objects and streams, then writes a PDF 1.7 file
// with a classic cross-reference table.

import { ByteWriter, latin1, hex } from '../util/bytes.js'
import { canCompress, deflate } from '../util/deflate.js'
import { PdfRef, serialize, hexString } from './objects.js'

export class PdfWriter {
  constructor({ compress = true } = {}) {
    this.objects = [] // index = id - 1: { value } | { stream: { dict, data, compress } }
    this.compress = compress && canCompress()
  }

  alloc() {
    this.objects.push(null)
    return new PdfRef(this.objects.length)
  }

  set(ref, value) {
    this.objects[ref.id - 1] = { value }
    return ref
  }

  add(value) {
    return this.set(this.alloc(), value)
  }

  // data: Uint8Array or string (latin1). filtered: data is already
  // encoded (dict carries its /Filter), so it's written as is.
  setStream(ref, dict, data, { compress = true, filtered = false } = {}) {
    const bytes = typeof data === 'string' ? latin1(data) : data
    this.objects[ref.id - 1] = { stream: { dict: { ...dict }, data: bytes, compress: compress && !filtered } }
    return ref
  }

  addStream(dict, data, options) {
    return this.setStream(this.alloc(), dict, data, options)
  }

  async build({ root, info }) {
    // Compress streams in parallel; keep the raw bytes when compression
    // doesn't help (tiny streams).
    if (this.compress) {
      await Promise.all(
        this.objects.map(async (obj) => {
          const s = obj?.stream
          if (!s || !s.compress || s.data.length < 64) return
          const packed = await deflate(s.data)
          if (packed.length < s.data.length) {
            s.data = packed
            s.dict.Filter = '/FlateDecode'
          }
        }),
      )
    }

    const out = new ByteWriter()
    out.write('%PDF-1.7\n')
    out.write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // binary marker
    const offsets = []
    this.objects.forEach((obj, i) => {
      offsets[i] = out.length
      out.write(`${i + 1} 0 obj\n`)
      if (!obj) out.write('null')
      else if (obj.stream) {
        const { dict, data } = obj.stream
        dict.Length = data.length
        out.write(serialize(dict))
        out.write('\nstream\n')
        out.write(data)
        out.write('\nendstream')
      } else out.write(serialize(obj.value))
      out.write('\nendobj\n')
    })

    const xref = out.length
    out.write(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`)
    for (const offset of offsets) out.write(String(offset).padStart(10, '0') + ' 00000 n \n')

    const id = hexString(fileId(this.objects.length, info))
    out.write(
      'trailer\n' +
        serialize({ Size: this.objects.length + 1, Root: root, Info: info, ID: [id, id] }) +
        `\nstartxref\n${xref}\n%%EOF\n`,
    )
    return out.bytes()
  }
}

// A stable-enough document id (doesn't need to be cryptographic).
function fileId(count, info) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const seed = `${count}:${Date.now()}:${Math.random()}:${info?.id ?? ''}`
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2246822507) >>> 0
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = ((i < 8 ? h1 : h2) >>> ((i % 4) * 8)) & 0xff ^ (i * 37)
  return hex(bytes)
}
