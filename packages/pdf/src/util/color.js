// Colors: '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(…)', 'rgba(…)', CSS
// named colors, [r, g, b] (0-255), { c, m, y, k } (0-100), 'none' and
// 'transparent'. CSS var(--x, fallback) resolves to its fallback (that's
// how @tylix/charts SVG arrives).

const NAMED = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00',
  orange: 'ffa500', purple: '800080', gray: '808080', grey: '808080', silver: 'c0c0c0', maroon: '800000',
  navy: '000080', teal: '008080', olive: '808000', lime: '00ff00', aqua: '00ffff', cyan: '00ffff',
  fuchsia: 'ff00ff', magenta: 'ff00ff', pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', indigo: '4b0082',
  violet: 'ee82ee', coral: 'ff7f50', salmon: 'fa8072', tomato: 'ff6347', crimson: 'dc143c', khaki: 'f0e68c',
  beige: 'f5f5dc', ivory: 'fffff0', lavender: 'e6e6fa', tan: 'd2b48c', chocolate: 'd2691e', skyblue: '87ceeb',
  steelblue: '4682b4', slategray: '708090', slategrey: '708090', darkgray: 'a9a9a9', darkgrey: 'a9a9a9',
  lightgray: 'd3d3d3', lightgrey: 'd3d3d3', gainsboro: 'dcdcdc', whitesmoke: 'f5f5f5', darkblue: '00008b',
  darkgreen: '006400', darkred: '8b0000', royalblue: '4169e1', dodgerblue: '1e90ff', seagreen: '2e8b57',
  forestgreen: '228b22', firebrick: 'b22222', orchid: 'da70d6', plum: 'dda0dd', turquoise: '40e0d0',
  midnightblue: '191970', dimgray: '696969', dimgrey: '696969', aliceblue: 'f0f8ff', honeydew: 'f0fff0',
  mintcream: 'f5fffa', linen: 'faf0e6', snow: 'fffafa', wheat: 'f5deb3', peru: 'cd853f', sienna: 'a0522d',
}

// Returns { space: 'rgb' | 'cmyk', values: [...0-1], alpha } or null for
// "no paint".
export function parseColor(input, currentColor = '#000000') {
  if (input == null || input === false) return null
  if (Array.isArray(input)) {
    if (input.length === 4) return { space: 'cmyk', values: input.map((v) => v / 100), alpha: 1 }
    return { space: 'rgb', values: input.slice(0, 3).map((v) => v / 255), alpha: input[3] ?? 1 }
  }
  if (typeof input === 'object') {
    if ('c' in input) return { space: 'cmyk', values: [input.c, input.m, input.y, input.k].map((v) => (v ?? 0) / 100), alpha: 1 }
    if ('r' in input) return { space: 'rgb', values: [input.r, input.g, input.b].map((v) => (v ?? 0) / 255), alpha: input.a ?? 1 }
  }
  let text = String(input).trim()
  const v = /^var\(\s*--[\w-]+\s*(?:,\s*(.+))?\)$/i.exec(text)
  if (v) {
    if (!v[1]) return parseColor(currentColor)
    text = v[1].trim()
  }
  const lower = text.toLowerCase()
  if (lower === 'none' || lower === 'transparent' || lower === '') return null
  if (lower === 'currentcolor') return parseColor(currentColor, '#000000')
  if (NAMED[lower]) text = '#' + NAMED[lower]
  if (text.startsWith('#')) {
    let h = text.slice(1)
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`Invalid color "${input}"`)
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255
    return { space: 'rgb', values: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) : 1 }
  }
  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(text)
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean)
    const num = (p, scale) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p))
    const alpha = parts[3] != null ? num(parts[3], 1) : 1
    if (fn[1].toLowerCase().startsWith('rgb')) {
      return { space: 'rgb', values: parts.slice(0, 3).map((p) => num(p, 255) / 255), alpha }
    }
    const h = (parseFloat(parts[0]) % 360) / 360
    const s = num(parts[1], 1)
    const l = num(parts[2], 1)
    return { space: 'rgb', values: hslToRgb(h, s, l), alpha }
  }
  throw new Error(`Invalid color "${input}"`)
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const t = (x) => {
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [t(h + 1 / 3), t(h), t(h - 1 / 3)]
}
