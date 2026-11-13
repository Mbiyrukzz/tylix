// Font families: the built-in Helvetica / Times / Courier plus any
// TrueType / OpenType fonts the document registers.

import { StandardFont, standardVariant } from './StandardFont.js'
import { TrueTypeFont } from './TrueTypeFont.js'

const ALIASES = {
  helvetica: 'Helvetica', arial: 'Helvetica', sans: 'Helvetica', 'sans-serif': 'Helvetica', 'system-ui': 'Helvetica',
  times: 'Times', 'times new roman': 'Times', serif: 'Times',
  courier: 'Courier', 'courier new': 'Courier', mono: 'Courier', monospace: 'Courier',
}

const VARIANTS = ['normal', 'bold', 'italic', 'bolditalic']

export class FontRegistry {
  constructor() {
    this.families = new Map() // lower name -> { normal, bold, italic, bolditalic } (TrueTypeFont)
    this.standard = new Map()
    this.fallbacks = []
  }

  // files: bytes, or { normal, bold, italic, bolditalic } of bytes.
  register(family, files) {
    const set = {}
    const entries = files instanceof Uint8Array ? { normal: files } : files
    for (const [key, bytes] of Object.entries(entries)) {
      const variant = key.toLowerCase().replace(/[^a-z]/g, '')
      const name = variant === 'regular' ? 'normal' : variant === 'italicbold' ? 'bolditalic' : variant
      if (!VARIANTS.includes(name)) throw new Error(`Unknown font variant "${key}" for "${family}" (use normal, bold, italic, bolditalic)`)
      if (bytes) set[name] = new TrueTypeFont(bytes)
    }
    if (!set.normal) set.normal = set.bold ?? set.italic ?? set.bolditalic
    if (!set.normal) throw new Error(`Font "${family}" has no files`)
    this.families.set(family.toLowerCase(), set)
    return this
  }

  has(family) {
    const key = String(family).toLowerCase()
    return this.families.has(key) || key in ALIASES
  }

  // { font, bold, italic } -> { font, fauxBold }
  resolveStyle({ font: family = 'Helvetica', bold = false, italic = false } = {}) {
    const families = String(family).split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''))
    for (const name of families) {
      const key = name.toLowerCase()
      const set = this.families.get(key)
      if (set) {
        const want = (bold ? 'bold' : '') + (italic ? 'italic' : '') || 'normal'
        const font = set[want] ?? (bold && italic ? set.bold ?? set.italic : null) ?? set.normal
        const fauxBold = bold && font !== set.bold && font !== set.bolditalic
        return { font, fauxBold }
      }
      if (ALIASES[key]) return { font: this.standardFont(standardVariant(ALIASES[key], bold, italic)), fauxBold: false }
    }
    return { font: this.standardFont(standardVariant('Helvetica', bold, italic)), fauxBold: false }
  }

  resolve(style) {
    return this.resolveStyle(style).font
  }

  standardFont(name) {
    let font = this.standard.get(name)
    if (!font) {
      font = new StandardFont(name)
      this.standard.set(name, font)
    }
    return font
  }

  // Characters the font can't draw are given to the first fallback
  // family that can. Returns [{ text, font, fauxBold }].
  cover(text, resolved, style) {
    if (!this.fallbacks.length) return [{ text, ...resolved }]
    const pieces = []
    let current = null
    for (const ch of text) {
      let pick = resolved
      if (!canDraw(resolved.font, ch)) {
        for (const family of this.fallbacks) {
          const alt = this.resolveStyle({ ...style, font: family })
          if (canDraw(alt.font, ch)) {
            pick = alt
            break
          }
        }
      }
      if (current && current.font === pick.font) current.text += ch
      else {
        current = { text: ch, ...pick }
        pieces.push(current)
      }
    }
    return pieces
  }

  allFonts() {
    const out = [...this.standard.values()]
    for (const set of this.families.values()) for (const f of new Set(Object.values(set))) out.push(f)
    return out
  }
}

function canDraw(font, ch) {
  if (/\s/.test(ch)) return true
  if (font.standard) return font.code(ch) !== 63 || ch === '?'
  return font.hasGlyph(ch)
}
