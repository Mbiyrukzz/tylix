// Cell styles -> styles.xml. A style is a plain object:
//   { bold, italic, underline, strike, font, size, color,
//     fill (or background), align, valign, wrap, indent, rotate,
//     border, format }
// Identical styles share one entry.

import { escapeXml } from './refs.js'

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', KES: 'KSh ', NGN: '₦', ZAR: 'R ', UGX: 'USh ', TZS: 'TSh ',
  CAD: 'CA$', AUD: 'A$', CHF: 'CHF ', SEK: 'kr ', BRL: 'R$', MXN: 'MX$', KRW: '₩', RUB: '₽', TRY: '₺', AED: 'AED ', GHS: 'GH₵', RWF: 'RF ',
}

// Named formats -> Excel number format codes.
export function formatCode(format, { currency = 'USD' } = {}) {
  if (format == null) return null
  const sym = CURRENCY_SYMBOLS[String(currency).toUpperCase()] ?? `${currency} `
  const quoted = `"${sym.replace(/"/g, '')}"`
  switch (format) {
    case 'general': return 'General'
    case 'integer': return '#,##0'
    case 'number': return '#,##0.##;-#,##0.##;0'
    case 'decimal': return '#,##0.00'
    case 'currency': return `${quoted}#,##0.00;-${quoted}#,##0.00`
    case 'accounting': return `_(${quoted}* #,##0.00_);_(${quoted}* (#,##0.00);_(${quoted}* "-"??_);_(@_)`
    case 'percent': return '0%'
    case 'percent1': return '0.0%'
    case 'percent2': return '0.00%'
    case 'date': return 'yyyy-mm-dd'
    case 'datetime': return 'yyyy-mm-dd hh:mm'
    case 'time': return 'hh:mm:ss'
    case 'text': return '@'
    case 'scientific': return '0.00E+00'
  }
  return String(format) // already a format code
}

const BUILTIN_FORMATS = {
  General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '# ?/?': 12,
  'mm-dd-yy': 14, 'd-mmm-yy': 15, 'd-mmm': 16, 'mmm-yy': 17, 'h:mm AM/PM': 18, 'h:mm:ss AM/PM': 19, 'h:mm': 20,
  'h:mm:ss': 21, 'm/d/yy h:mm': 22, '@': 49,
}

export function argb(color) {
  if (color == null) return null
  let c = String(color).trim()
  const named = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500' }
  if (named[c.toLowerCase()]) c = '#' + named[c.toLowerCase()]
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(c)
  if (rgb) {
    const a = rgb[4] != null ? Math.round(Number(rgb[4]) * 255) : 255
    return [a, rgb[1], rgb[2], rgb[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  c = c.replace(/^#/, '')
  if (c.length === 3) c = [...c].map((x) => x + x).join('')
  if (c.length === 6) return ('FF' + c).toUpperCase()
  if (c.length === 8) return (c.slice(6) + c.slice(0, 6)).toUpperCase() // #rrggbbaa -> aarrggbb
  throw new Error(`Invalid color "${color}"`)
}

const BORDER_STYLES = new Set(['thin', 'medium', 'thick', 'dashed', 'dotted', 'double', 'hair', 'mediumDashed', 'dashDot', 'mediumDashDot', 'dashDotDot', 'slantDashDot'])

function normalizeBorder(border) {
  if (!border) return null
  const side = (v, color) => {
    if (!v) return null
    if (v === true) return { style: 'thin', color }
    if (typeof v === 'string') return { style: BORDER_STYLES.has(v) ? v : 'thin', color: BORDER_STYLES.has(v) ? color : v }
    return { style: v.style ?? 'thin', color: v.color ?? color }
  }
  if (border === true || typeof border === 'string') {
    const s = side(border, '#D1D5DB')
    return { top: s, right: s, bottom: s, left: s }
  }
  const color = border.color ?? '#D1D5DB'
  const all = border.style ? side(border.style, color) : null
  return {
    top: side(border.top, color) ?? all,
    right: side(border.right, color) ?? all,
    bottom: side(border.bottom, color) ?? all,
    left: side(border.left, color) ?? all,
  }
}

export class StyleRegistry {
  constructor({ currency, font = 'Calibri', size = 11 } = {}) {
    this.currency = currency
    this.defaultFont = { name: font, size }
    this.fonts = [this.fontXml({})]
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
    this.numFmts = new Map() // code -> id
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
    this.dxfs = []
    this.cache = new Map()
    this.index = { fonts: new Map([[this.fonts[0], 0]]), fills: new Map(), borders: new Map([[this.borders[0], 0]]), xfs: new Map([[this.xfs[0], 0]]) }
  }

  fontXml(s) {
    let x = '<font>'
    if (s.bold) x += '<b/>'
    if (s.italic) x += '<i/>'
    if (s.strike) x += '<strike/>'
    if (s.underline) x += s.underline === 'double' ? '<u val="double"/>' : '<u/>'
    if (s.superscript || s.subscript) x += `<vertAlign val="${s.superscript ? 'superscript' : 'subscript'}"/>`
    x += `<sz val="${s.size ?? this.defaultFont.size}"/>`
    if (s.color) x += `<color rgb="${argb(s.color)}"/>`
    x += `<name val="${escapeXml(s.font ?? this.defaultFont.name)}"/>`
    return x + '</font>'
  }

  add(list, map, xml) {
    let id = map.get(xml)
    if (id === undefined) {
      id = list.length
      list.push(xml)
      map.set(xml, id)
    }
    return id
  }

  numFmtId(format) {
    const code = formatCode(format, { currency: this.currency })
    if (code == null) return 0
    if (code in BUILTIN_FORMATS) return BUILTIN_FORMATS[code]
    let id = this.numFmts.get(code)
    if (id === undefined) {
      id = 164 + this.numFmts.size
      this.numFmts.set(code, id)
    }
    return id
  }

  // Style object -> cellXfs index.
  id(style) {
    if (!style) return 0
    const key = JSON.stringify(style)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const fontId = this.add(this.fonts, this.index.fonts, this.fontXml(style))
    const fill = style.fill ?? style.background
    let fillId = 0
    if (fill) fillId = this.add(this.fills, this.index.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(fill)}"/><bgColor indexed="64"/></patternFill></fill>`)
    let borderId = 0
    const border = normalizeBorder(style.border)
    if (border) borderId = this.add(this.borders, this.index.borders, borderXml(border))
    const numFmtId = this.numFmtId(style.format)
    let xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
    if (numFmtId) xf += ' applyNumberFormat="1"'
    if (fontId) xf += ' applyFont="1"'
    if (fillId) xf += ' applyFill="1"'
    if (borderId) xf += ' applyBorder="1"'
    const align = alignmentXml(style)
    if (align) xf += ` applyAlignment="1">${align}</xf>`
    else xf += '/>'
    const id = this.add(this.xfs, this.index.xfs, xf)
    this.cache.set(key, id)
    return id
  }

  // Differential style for conditional formatting.
  dxf(style) {
    let x = '<dxf>'
    if (style.bold || style.italic || style.color || style.strike || style.underline) {
      x += '<font>'
      if (style.bold) x += '<b/>'
      if (style.italic) x += '<i/>'
      if (style.strike) x += '<strike/>'
      if (style.underline) x += '<u/>'
      if (style.color) x += `<color rgb="${argb(style.color)}"/>`
      x += '</font>'
    }
    if (style.format) x += `<numFmt numFmtId="${this.numFmtId(style.format)}" formatCode="${escapeXml(formatCode(style.format, { currency: this.currency }))}"/>`
    const fill = style.fill ?? style.background
    if (fill) x += `<fill><patternFill patternType="solid"><fgColor rgb="${argb(fill)}"/><bgColor rgb="${argb(fill)}"/></patternFill></fill>`
    const border = normalizeBorder(style.border)
    if (border) x += borderXml(border)
    x += '</dxf>'
    this.dxfs.push(x)
    return this.dxfs.length - 1
  }

  xml() {
    const numFmts = [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('')
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.numFmts.size ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs>` +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>'
    )
  }
}

function borderXml(b) {
  const side = (name, s) => (s ? `<${name} style="${s.style}"><color rgb="${argb(s.color)}"/></${name}>` : `<${name}/>`)
  return `<border>${side('left', b.left)}${side('right', b.right)}${side('top', b.top)}${side('bottom', b.bottom)}<diagonal/></border>`
}

function alignmentXml(s) {
  const a = []
  const h = s.align ?? s.horizontal
  if (h) a.push(`horizontal="${h === 'middle' ? 'center' : h}"`)
  const v = s.valign ?? s.vertical
  if (v) a.push(`vertical="${v === 'middle' ? 'center' : v}"`)
  if (s.wrap) a.push('wrapText="1"')
  if (s.indent) a.push(`indent="${s.indent}"`)
  if (s.rotate) a.push(`textRotation="${s.rotate < 0 ? 90 - s.rotate : s.rotate}"`)
  if (s.shrink) a.push('shrinkToFit="1"')
  return a.length ? `<alignment ${a.join(' ')}/>` : ''
}

// Number format code -> is it a date/time format? (for reading)
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

export function isDateFormat(id, code) {
  if (BUILTIN_DATE_IDS.has(id)) return true
  if (!code) return false
  // Drop quoted text, escaped chars, colors/conditions/locale in [] (but
  // keep elapsed-time [h]), then look for date/time tokens.
  const clean = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '')
    .split(';')[0]
  return /[dmyhs]/i.test(clean) && !/^[#0.,%E+\-\s]*$/.test(clean)
}
