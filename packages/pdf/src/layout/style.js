// Styles: defaults, named styles and per-node properties, plus lengths
// with units ("12mm", "1in").

export const PAGE_SIZES = {
  A0: [2383.94, 3370.39], A1: [1683.78, 2383.94], A2: [1190.55, 1683.78], A3: [841.89, 1190.55],
  A4: [595.28, 841.89], A5: [419.53, 595.28], A6: [297.64, 419.53], B4: [708.66, 1000.63], B5: [498.9, 708.66],
  LETTER: [612, 792], LEGAL: [612, 1008], TABLOID: [792, 1224], LEDGER: [1224, 792], EXECUTIVE: [521.86, 756],
}

const UNITS = { pt: 1, px: 0.75, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 }

export function len(value, relativeTo) {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') return value
  const m = /^(-?[\d.]+)\s*(pt|px|in|mm|cm|%)?$/.exec(String(value).trim())
  if (!m) throw new Error(`Invalid length "${value}" (use points or a unit: pt, px, mm, cm, in)`)
  const n = Number(m[1])
  if (m[2] === '%') return relativeTo != null ? (n / 100) * relativeTo : undefined
  return n * (UNITS[m[2] ?? 'pt'])
}

// 4 numbers [top, right, bottom, left] from a number, [v, h],
// [t, r, b, l] or { top, right, bottom, left, x, y }.
export function box(value, fallback = 0) {
  if (value == null) return [fallback, fallback, fallback, fallback]
  if (typeof value === 'number' || typeof value === 'string') {
    const v = len(value)
    return [v, v, v, v]
  }
  if (Array.isArray(value)) {
    const v = value.map((x) => len(x) ?? 0)
    if (v.length === 1) return [v[0], v[0], v[0], v[0]]
    if (v.length === 2) return [v[0], v[1], v[0], v[1]]
    if (v.length === 3) return [v[0], v[1], v[2], v[1]]
    return v.slice(0, 4)
  }
  const y = len(value.y ?? value.vertical)
  const x = len(value.x ?? value.horizontal)
  return [
    len(value.top) ?? y ?? fallback,
    len(value.right) ?? x ?? fallback,
    len(value.bottom) ?? y ?? fallback,
    len(value.left) ?? x ?? fallback,
  ]
}

export function pageSize(size = 'A4', orientation) {
  let dims
  if (Array.isArray(size)) dims = size.map((v) => len(v))
  else if (typeof size === 'object') dims = [len(size.width), len(size.height)]
  else {
    dims = PAGE_SIZES[String(size).toUpperCase()]
    if (!dims) throw new Error(`Unknown page size "${size}". Use ${Object.keys(PAGE_SIZES).join(', ')} or [width, height]`)
  }
  let [w, h] = dims
  if (orientation === 'landscape' && w < h) [w, h] = [h, w]
  if (orientation === 'portrait' && w > h) [w, h] = [h, w]
  return [w, h]
}

// Text properties that children inherit.
export const TEXT_PROPS = [
  'font', 'size', 'bold', 'italic', 'color', 'lineHeight', 'align', 'characterSpacing', 'underline', 'strike',
  'decorationColor', 'background', 'link', 'opacity', 'baseline',
]

export const DEFAULT_STYLE = {
  font: 'Helvetica',
  size: 10.5,
  color: '#111827',
  lineHeight: 1.4,
  align: 'left',
}

// Built-in named styles; documents can override or add to them.
export const BUILTIN_STYLES = {
  h1: { size: 24, bold: true, lineHeight: 1.2, marginTop: 18, marginBottom: 10 },
  h2: { size: 18, bold: true, lineHeight: 1.25, marginTop: 16, marginBottom: 8 },
  h3: { size: 14.5, bold: true, lineHeight: 1.3, marginTop: 14, marginBottom: 6 },
  h4: { size: 12.5, bold: true, lineHeight: 1.3, marginTop: 12, marginBottom: 4 },
  h5: { size: 11, bold: true, lineHeight: 1.3, marginTop: 10, marginBottom: 4 },
  h6: { size: 10, bold: true, lineHeight: 1.3, marginTop: 10, marginBottom: 4, color: '#4b5563' },
  paragraph: { marginBottom: 8 },
  small: { size: 8.5 },
  muted: { color: '#6b7280' },
  lead: { size: 13, color: '#374151' },
  code: { font: 'Courier', size: 9.5 },
  link: { color: '#2563eb', underline: true },
  tableHeader: { bold: true, background: '#f3f4f6', color: '#111827' },
  tableFooter: { bold: true },
  caption: { size: 8.5, color: '#6b7280', align: 'center', marginTop: 4 },
}

export class StyleSheet {
  constructor(styles = {}, defaults = {}) {
    this.styles = { ...BUILTIN_STYLES }
    for (const [name, value] of Object.entries(styles)) this.styles[name] = { ...(this.styles[name] || {}), ...value }
    this.defaults = { ...DEFAULT_STYLE, ...defaults }
  }

  // The named styles a node asks for, merged in order.
  named(names) {
    if (!names) return {}
    const list = Array.isArray(names) ? names : String(names).split(/\s+/)
    const out = {}
    for (const n of list) {
      const s = this.styles[n]
      if (!s) throw new Error(`Unknown style "${n}"`)
      Object.assign(out, s)
    }
    return out
  }

  // Inherited text style + node's own (named styles first, then props).
  resolve(node, inherited) {
    const own = { ...this.named(node.style), ...pick(node) }
    const text = { ...inherited }
    for (const key of TEXT_PROPS) if (own[key] !== undefined) text[key] = own[key]
    return { text, own }
  }
}

function pick(node) {
  const out = {}
  for (const [k, v] of Object.entries(node)) if (v !== undefined) out[k] = v
  return out
}

// Text props that shouldn't flow from a block into its children.
export function blockOnly(text) {
  const t = { ...text }
  delete t.background
  return t
}
