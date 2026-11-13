// Embedded TrueType (.ttf) and OpenType (.otf) fonts, written as Type0
// / Identity-H CID fonts so any Unicode text the font covers works.
// TrueType outlines are subset to the glyphs actually used; CFF-based
// OpenType fonts are embedded whole. A ToUnicode map keeps the text
// searchable and copyable.

import { readU16, readI16, readU32, concat } from '../util/bytes.js'

let subsetCounter = 0

export class TrueTypeFont {
  constructor(bytes, { name } = {}) {
    this.bytes = bytes
    this.standard = false
    this.tables = readTableDirectory(bytes)
    const t = this.tables
    if (t.CFF2) throw new Error("Variable OpenType (CFF2) fonts can't be embedded in a PDF. Use the font's .ttf or a static .otf instead.")
    if (!t.head || !t.hhea || !t.hmtx || !t.cmap || !t.maxp) throw new Error('Not a usable TrueType/OpenType font (missing tables)')
    this.isCff = Boolean(t['CFF '])
    this.inCollection = Boolean(t.__collection)
    const head = t.head.offset
    this.unitsPerEm = readU16(bytes, head + 18)
    this.indexToLocFormat = readI16(bytes, head + 50)
    this.bbox = [readI16(bytes, head + 36), readI16(bytes, head + 38), readI16(bytes, head + 40), readI16(bytes, head + 42)].map((v) => this.scale(v))
    const hhea = t.hhea.offset
    let ascent = readI16(bytes, hhea + 4)
    let descent = readI16(bytes, hhea + 6)
    let lineGap = readI16(bytes, hhea + 8)
    this.numberOfHMetrics = readU16(bytes, hhea + 34)
    this.numGlyphs = readU16(bytes, t.maxp.offset + 4)
    this.capHeight = ascent
    this.weight = 400
    this.italicAngle = 0
    this.fixedPitch = false
    if (t['OS/2']) {
      const os2 = t['OS/2'].offset
      const version = readU16(bytes, os2)
      this.weight = readU16(bytes, os2 + 4)
      const useTypo = readU16(bytes, os2 + 62) & 0x80
      if (useTypo) {
        ascent = readI16(bytes, os2 + 68)
        descent = readI16(bytes, os2 + 70)
        lineGap = readI16(bytes, os2 + 72)
      }
      if (version >= 2 && t['OS/2'].length >= 90) this.capHeight = readI16(bytes, os2 + 88)
    }
    if (t.post) {
      const post = t.post.offset
      this.italicAngle = readI16(bytes, post + 4) + readU16(bytes, post + 6) / 65536
      this.underlinePosition = this.scale(readI16(bytes, post + 8))
      this.underlineThickness = this.scale(readI16(bytes, post + 10))
      this.fixedPitch = readU32(bytes, post + 12) !== 0
    }
    this.ascent = this.scale(ascent)
    this.descent = this.scale(descent)
    this.lineGap = this.scale(lineGap)
    this.capHeight = this.scale(this.capHeight)
    this.underlinePosition ??= -100
    this.underlineThickness ??= 50
    this.postscriptName = (name || readPostScriptName(bytes, t.name) || 'EmbeddedFont').replace(/[^A-Za-z0-9-]/g, '')
    this.cmap = readCmap(bytes, t.cmap.offset)
    this.advanceCache = new Map()
    this.kerning = readKern(bytes, t.kern)
    this.used = new Map([[0, '']]) // gid -> unicode text
    this.ref = null
  }

  scale(v) {
    return (v * 1000) / this.unitsPerEm
  }

  gid(cp) {
    return this.cmap.get(cp) ?? 0
  }

  advance(gid) {
    let w = this.advanceCache.get(gid)
    if (w === undefined) {
      const hmtx = this.tables.hmtx.offset
      const i = Math.min(gid, this.numberOfHMetrics - 1)
      w = this.scale(readU16(this.bytes, hmtx + i * 4))
      this.advanceCache.set(gid, w)
    }
    return w
  }

  hasGlyph(ch) {
    return this.cmap.has(ch.codePointAt(0))
  }

  measure(text) {
    let w = 0
    let prev = -1
    for (const ch of text) {
      const g = this.gid(ch.codePointAt(0))
      w += this.advance(g)
      if (prev >= 0 && this.kerning) w += this.scale(this.kerning.get(prev * 65536 + g) ?? 0)
      prev = g
    }
    return w
  }

  show(text, wordSpacing = 0) {
    const parts = []
    let run = ''
    let prev = -1
    for (const ch of text) {
      const cp = ch.codePointAt(0)
      const g = this.gid(cp === 9 ? 32 : cp)
      if (!this.used.has(g)) this.used.set(g, ch)
      const kern = prev >= 0 && this.kerning ? this.scale(this.kerning.get(prev * 65536 + g) ?? 0) : 0
      if (kern) {
        parts.push('<' + run + '>', String(-Math.round(kern * 100) / 100))
        run = ''
      }
      run += g.toString(16).padStart(4, '0')
      prev = g
      if (cp === 32 && wordSpacing) {
        parts.push('<' + run + '>', String(-Math.round(wordSpacing * 100) / 100))
        run = ''
      }
    }
    if (run) parts.push('<' + run + '>')
    if (parts.length === 1) return parts[0] + ' Tj'
    return '[' + parts.join(' ') + '] TJ'
  }

  embed(writer) {
    if (!this.ref) {
      this.ref = writer.alloc()
      this.writer = writer
    }
    return this.ref
  }

  // Called once all text is laid out, when the used glyphs are known.
  finalize(writer) {
    if (!this.ref) return
    const tag = subsetTag(++subsetCounter)
    const baseName = this.isCff ? this.postscriptName : `${tag}+${this.postscriptName}`
    const gids = [...this.used.keys()].sort((a, b) => a - b)

    let fontFile
    if (this.isCff) {
      // CFF outlines are embedded whole (a font from a collection is
      // first copied out into a standalone file).
      const data = this.inCollection ? extractFont(this.bytes, this.tables) : this.bytes
      fontFile = writer.addStream({ Subtype: '/OpenType' }, data)
    } else {
      const data = subsetTrueType(this.bytes, this.tables, gids, this.indexToLocFormat, this.numGlyphs)
      fontFile = writer.addStream({ Length1: data.length }, data)
    }

    let flags = 32 // nonsymbolic
    if (this.fixedPitch) flags |= 1
    if (this.italicAngle) flags |= 64
    const descriptor = writer.add({
      Type: '/FontDescriptor',
      FontName: '/' + baseName,
      Flags: flags,
      FontBBox: this.bbox.map(Math.round),
      ItalicAngle: this.italicAngle,
      Ascent: Math.round(this.ascent),
      Descent: Math.round(this.descent),
      CapHeight: Math.round(this.capHeight),
      StemV: this.weight >= 600 ? 120 : 80,
      [this.isCff ? 'FontFile3' : 'FontFile2']: fontFile,
    })

    const widths = []
    for (const g of gids) widths.push(g, [Math.round(this.advance(g))])
    const cidFont = writer.add({
      Type: '/Font',
      Subtype: this.isCff ? '/CIDFontType0' : '/CIDFontType2',
      BaseFont: '/' + baseName,
      CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
      FontDescriptor: descriptor,
      W: widths,
      DW: 0,
      ...(this.isCff ? {} : { CIDToGIDMap: '/Identity' }),
    })
    const toUnicode = writer.addStream({}, toUnicodeCMap(this.used))
    writer.set(this.ref, {
      Type: '/Font',
      Subtype: '/Type0',
      BaseFont: '/' + baseName,
      Encoding: '/Identity-H',
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode,
    })
  }
}

function subsetTag(n) {
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += String.fromCharCode(65 + (n % 26))
    n = Math.floor(n / 26) + i * 7
  }
  return s
}

function readTableDirectory(bytes) {
  let base = 0
  const sig = readU32(bytes, 0)
  if (sig === 0x74746366) {
    // TrueType collection: use the first font.
    base = readU32(bytes, 12)
  } else if (sig === 0x774f4646 || sig === 0x774f4632) {
    throw new Error('WOFF/WOFF2 fonts are not supported; use the .ttf or .otf file')
  }
  const count = readU16(bytes, base + 4)
  const tables = {}
  if (base) Object.defineProperty(tables, '__collection', { value: true })
  for (let i = 0; i < count; i++) {
    const o = base + 12 + i * 16
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
    tables[tag] = { offset: readU32(bytes, o + 8), length: readU32(bytes, o + 12) }
  }
  return tables
}

function readPostScriptName(bytes, table) {
  if (!table) return null
  const o = table.offset
  const count = readU16(bytes, o + 2)
  const strings = o + readU16(bytes, o + 4)
  let fallback = null
  for (let i = 0; i < count; i++) {
    const r = o + 6 + i * 12
    const platform = readU16(bytes, r)
    const nameId = readU16(bytes, r + 6)
    if (nameId !== 6) continue
    const len = readU16(bytes, r + 8)
    const off = strings + readU16(bytes, r + 10)
    if (platform === 3 || platform === 0) {
      let s = ''
      for (let j = 0; j < len; j += 2) s += String.fromCharCode(readU16(bytes, off + j))
      return s
    }
    fallback = String.fromCharCode(...bytes.subarray(off, off + len))
  }
  return fallback
}

// Unicode -> glyph id, from a format 12 (full Unicode) or format 4 (BMP)
// subtable.
function readCmap(bytes, offset) {
  const count = readU16(bytes, offset + 2)
  let best = null
  let bestScore = -1
  for (let i = 0; i < count; i++) {
    const r = offset + 4 + i * 8
    const platform = readU16(bytes, r)
    const encoding = readU16(bytes, r + 2)
    const sub = offset + readU32(bytes, r + 4)
    const format = readU16(bytes, sub)
    let score = -1
    if (format === 12 && (platform === 3 || platform === 0)) score = 3
    else if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) score = 2
    if (score > bestScore) {
      best = { sub, format }
      bestScore = score
    }
  }
  const map = new Map()
  if (!best) throw new Error('Font has no Unicode cmap')
  const { sub, format } = best
  if (format === 12) {
    const groups = readU32(bytes, sub + 12)
    for (let i = 0; i < groups; i++) {
      const g = sub + 16 + i * 12
      const start = readU32(bytes, g)
      const end = readU32(bytes, g + 4)
      const gid = readU32(bytes, g + 8)
      for (let c = start; c <= end && c - start < 0x10000; c++) map.set(c, gid + (c - start))
    }
  } else {
    const segX2 = readU16(bytes, sub + 6)
    const ends = sub + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const rangeOffsets = deltas + segX2
    for (let s = 0; s < segX2; s += 2) {
      const end = readU16(bytes, ends + s)
      const start = readU16(bytes, starts + s)
      const delta = readI16(bytes, deltas + s)
      const ro = readU16(bytes, rangeOffsets + s)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g
        if (ro === 0) g = (c + delta) & 0xffff
        else {
          const at = rangeOffsets + s + ro + (c - start) * 2
          g = readU16(bytes, at)
          if (g) g = (g + delta) & 0xffff
        }
        if (g) map.set(c, g)
      }
    }
  }
  return map
}

// Legacy 'kern' table, format 0 (horizontal pairs).
function readKern(bytes, table) {
  if (!table) return null
  const o = table.offset
  const version = readU16(bytes, o)
  if (version !== 0) return null
  const nTables = readU16(bytes, o + 2)
  let p = o + 4
  const pairs = new Map()
  for (let t = 0; t < nTables; t++) {
    const length = readU16(bytes, p + 2)
    const coverage = readU16(bytes, p + 4)
    if (coverage >> 8 === 0 && (coverage & 1) === 1) {
      const n = readU16(bytes, p + 6)
      for (let i = 0; i < n; i++) {
        const e = p + 14 + i * 6
        pairs.set(readU16(bytes, e) * 65536 + readU16(bytes, e + 2), readI16(bytes, e + 4))
      }
    }
    p += length
  }
  return pairs.size ? pairs : null
}

// Keeps glyph ids as they are (so CIDToGIDMap stays Identity) but empties
// every glyph that isn't used, including composite components.
function subsetTrueType(bytes, tables, gids, locFormat, numGlyphs) {
  const loca = tables.loca.offset
  const glyf = tables.glyf.offset
  const glyphRange = (g) => {
    if (locFormat === 0) return [readU16(bytes, loca + g * 2) * 2, readU16(bytes, loca + g * 2 + 2) * 2]
    return [readU32(bytes, loca + g * 4), readU32(bytes, loca + g * 4 + 4)]
  }
  const keep = new Set(gids)
  const queue = [...gids]
  while (queue.length) {
    const g = queue.pop()
    if (g >= numGlyphs) continue
    const [start, end] = glyphRange(g)
    if (end <= start) continue
    const p = glyf + start
    if (readI16(bytes, p) >= 0) continue
    // Composite glyph: follow its components.
    let q = p + 10
    for (;;) {
      const flags = readU16(bytes, q)
      const component = readU16(bytes, q + 2)
      if (!keep.has(component)) {
        keep.add(component)
        queue.push(component)
      }
      q += 4 + (flags & 1 ? 4 : 2)
      if (flags & 8) q += 2
      else if (flags & 0x40) q += 4
      else if (flags & 0x80) q += 8
      if (!(flags & 0x20)) break
    }
  }

  const glyphParts = []
  const newLoca = new Uint8Array((numGlyphs + 1) * 4)
  const locaView = new DataView(newLoca.buffer)
  let size = 0
  for (let g = 0; g < numGlyphs; g++) {
    locaView.setUint32(g * 4, size)
    if (!keep.has(g)) continue
    const [start, end] = glyphRange(g)
    if (end <= start) continue
    let data = bytes.subarray(glyf + start, glyf + end)
    if (data.length % 4) data = concat([data, new Uint8Array(4 - (data.length % 4))])
    glyphParts.push(data)
    size += data.length
  }
  locaView.setUint32(numGlyphs * 4, size)

  const out = {}
  for (const tag of ['cvt ', 'fpgm', 'prep', 'hhea', 'hmtx', 'maxp']) {
    if (tables[tag]) out[tag] = bytes.slice(tables[tag].offset, tables[tag].offset + tables[tag].length)
  }
  const head = bytes.slice(tables.head.offset, tables.head.offset + tables.head.length)
  head[50] = 0
  head[51] = 1 // long loca
  head.fill(0, 8, 12) // checkSumAdjustment
  out.head = head
  out.loca = newLoca
  out.glyf = concat(glyphParts)
  return writeFontFile(out)
}

function extractFont(bytes, tables) {
  const out = {}
  for (const [tag, t] of Object.entries(tables)) out[tag] = bytes.slice(t.offset, t.offset + t.length)
  return writeFontFile(out, 0x4f54544f)
}

function checksum(data) {
  let sum = 0
  const padded = data.length % 4 ? concat([data, new Uint8Array(4 - (data.length % 4))]) : data
  for (let i = 0; i < padded.length; i += 4) sum = (sum + readU32(padded, i)) >>> 0
  return sum
}

function writeFontFile(tables, version = 0x00010000) {
  const tags = Object.keys(tables).sort()
  const n = tags.length
  const header = new Uint8Array(12 + n * 16)
  const view = new DataView(header.buffer)
  let pow = 1
  let log = 0
  while (pow * 2 <= n) {
    pow *= 2
    log++
  }
  view.setUint32(0, version)
  view.setUint16(4, n)
  view.setUint16(6, pow * 16)
  view.setUint16(8, log)
  view.setUint16(10, n * 16 - pow * 16)
  let offset = header.length
  const bodies = []
  tags.forEach((tag, i) => {
    const data = tables[tag]
    const r = 12 + i * 16
    for (let j = 0; j < 4; j++) header[r + j] = tag.charCodeAt(j)
    view.setUint32(r + 4, checksum(data))
    view.setUint32(r + 8, offset)
    view.setUint32(r + 12, data.length)
    const pad = (4 - (data.length % 4)) % 4
    bodies.push(data, new Uint8Array(pad))
    offset += data.length + pad
  })
  return concat([header, ...bodies])
}

function utf16hex(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, '0')
  return out
}

function toUnicodeCMap(used) {
  const entries = [...used].filter(([g, t]) => g && t)
  let body = ''
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    body += `${chunk.length} beginbfchar\n`
    for (const [g, t] of chunk) body += `<${g.toString(16).padStart(4, '0')}> <${utf16hex(t)}>\n`
    body += 'endbfchar\n'
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <ffff>
endcodespacerange
${body}endcmap
CMapName currentdict /CMap defineresource pop
end
end
`
}
