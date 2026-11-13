// The 12 Latin PDF base fonts (Helvetica, Times, Courier families).
// Every viewer has them, so nothing is embedded. They cover WinAnsi
// (Western European) text; embed a TrueType font for anything else.

import { STANDARD_METRICS } from './standardMetrics.js'

// Unicode -> WinAnsi for the 0x80-0x9f block (the rest matches Latin-1).
const WIN_ANSI_EXTRA = {
  0x20ac: 128, 0x201a: 130, 0x0192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02c6: 136,
  0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147,
  0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02dc: 152, 0x2122: 153, 0x0161: 154, 0x203a: 155,
  0x0153: 156, 0x017e: 158, 0x0178: 159,
}

// Characters outside WinAnsi that have a close stand-in.
const SUBSTITUTES = { 0x2212: '-', 0x2010: '-', 0x2011: '-', 0x2009: ' ', 0x200a: ' ', 0x202f: ' ', 0x2002: ' ', 0x2003: ' ', 0x2032: "'", 0x2033: '"', 0x2715: 'x', 0x2713: 'v', 0x2192: '>', 0x2190: '<' }

export const STANDARD_FONTS = Object.keys(STANDARD_METRICS)

// "Helvetica" + bold/italic -> the concrete base font name.
export function standardVariant(family, bold, italic) {
  const f = family.toLowerCase()
  if (f.startsWith('times')) return ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'][(bold ? 1 : 0) + (italic ? 2 : 0)]
  const base = f.startsWith('courier') ? 'Courier' : 'Helvetica'
  if (bold && italic) return base + '-BoldOblique'
  if (bold) return base + '-Bold'
  if (italic) return base + '-Oblique'
  return base
}

const parsedKerning = new Map()

function kerningFor(name) {
  if (parsedKerning.has(name)) return parsedKerning.get(name)
  const table = new Map()
  const src = STANDARD_METRICS[name].kern
  if (src) {
    for (const entry of src.split(',')) {
      const a = parseInt(entry.slice(0, 2), 36)
      const b = parseInt(entry.slice(2, 4), 36)
      table.set(a * 256 + b, Number(entry.slice(4)))
    }
  }
  parsedKerning.set(name, table)
  return table
}

export class StandardFont {
  constructor(name) {
    const m = STANDARD_METRICS[name]
    if (!m) throw new Error(`Unknown standard font "${name}". Use one of: ${STANDARD_FONTS.join(', ')}`)
    this.name = name
    this.standard = true
    this.widths = m.widths.split(',').map(Number)
    this.kerning = kerningFor(name)
    this.ascent = m.ascender || m.bbox[3]
    this.descent = m.descender || m.bbox[1]
    this.lineGap = 0
    this.capHeight = m.capHeight
    this.underlinePosition = m.underlinePosition
    this.underlineThickness = m.underlineThickness
    this.ref = null
  }

  code(ch) {
    const cp = ch.codePointAt(0)
    if (cp >= 32 && cp < 127) return cp
    if (cp >= 160 && cp <= 255) return cp
    if (WIN_ANSI_EXTRA[cp]) return WIN_ANSI_EXTRA[cp]
    if (cp === 9) return 32
    if (SUBSTITUTES[cp]) return SUBSTITUTES[cp].charCodeAt(0)
    return 63 // '?'
  }

  codes(text) {
    const out = []
    for (const ch of text) out.push(this.code(ch))
    return out
  }

  // Advance width of text in 1/1000 em, with kerning.
  measure(text) {
    let w = 0
    let prev = -1
    for (const ch of text) {
      const c = this.code(ch)
      w += this.widths[c - 32] ?? 500
      if (prev >= 0) w += this.kerning.get(prev * 256 + c) ?? 0
      prev = c
    }
    return w
  }

  // Content-stream operator that shows text, with kerning and optional
  // extra space after each space character (for justified lines; in
  // text-space units, i.e. 1/1000 em).
  show(text, wordSpacing = 0) {
    const codes = this.codes(text)
    const parts = []
    let run = ''
    let prev = -1
    for (const c of codes) {
      const kern = prev >= 0 ? (this.kerning.get(prev * 256 + c) ?? 0) : 0
      if (kern) {
        parts.push('(' + run + ')', String(-kern))
        run = ''
      }
      run += escapeByte(c)
      prev = c
      if (c === 32 && wordSpacing) {
        parts.push('(' + run + ')', String(-round(wordSpacing)))
        run = ''
      }
    }
    if (run) parts.push('(' + run + ')')
    if (parts.length === 1) return parts[0] + ' Tj'
    return '[' + parts.join(' ') + '] TJ'
  }

  embed(writer) {
    if (!this.ref) {
      this.ref = writer.add({ Type: '/Font', Subtype: '/Type1', BaseFont: '/' + this.name, Encoding: '/WinAnsiEncoding' })
    }
    return this.ref
  }

  finalize() {}
}

const round = (n) => Math.round(n * 100) / 100

function escapeByte(c) {
  if (c === 0x28 || c === 0x29 || c === 0x5c) return '\\' + String.fromCharCode(c)
  if (c < 32 || c > 126) return '\\' + c.toString(8).padStart(3, '0')
  return String.fromCharCode(c)
}
