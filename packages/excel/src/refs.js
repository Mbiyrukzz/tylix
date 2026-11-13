// A1-style references, dates as Excel serial numbers, XML escaping.

export function columnName(index) {
  // 0 -> A, 25 -> Z, 26 -> AA
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function columnIndex(name) {
  let n = 0
  for (const ch of String(name).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// 'B3' -> { row: 2, col: 1 } (zero-based)
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(ref).trim())
  if (!m) throw new Error(`Invalid cell reference "${ref}"`)
  return { row: Number(m[2]) - 1, col: columnIndex(m[1]) }
}

export function cellRef(row, col) {
  return columnName(col) + (row + 1)
}

// 'A1:C10' -> { start, end }; a single cell is a 1x1 range.
export function parseRange(range) {
  const [a, b] = String(range).split(':')
  const start = parseRef(a)
  const end = b ? parseRef(b) : start
  return {
    start: { row: Math.min(start.row, end.row), col: Math.min(start.col, end.col) },
    end: { row: Math.max(start.row, end.row), col: Math.max(start.col, end.col) },
  }
}

export function rangeRef(start, end) {
  const a = cellRef(start.row, start.col)
  const b = cellRef(end.row, end.col)
  return a === b ? a : `${a}:${b}`
}

// Address input: 'B3', [row, col] (zero-based) or { row, col }.
export function toPosition(address, col) {
  if (typeof address === 'number') return { row: address, col: col ?? 0 }
  if (Array.isArray(address)) return { row: address[0], col: address[1] }
  if (typeof address === 'object') return { row: address.row, col: address.col }
  return parseRef(address)
}

const MS_PER_DAY = 86400000
const EPOCH_1900 = Date.UTC(1899, 11, 30)
const EPOCH_1904 = Date.UTC(1904, 0, 1)

// Dates are written in UTC by default; pass the local offset to keep
// wall-clock times instead (dateMode: 'local').
export function dateToSerial(date, { date1904 = false, local = false } = {}) {
  let ms = date.getTime()
  if (local) ms -= date.getTimezoneOffset() * 60000
  return (ms - (date1904 ? EPOCH_1904 : EPOCH_1900)) / MS_PER_DAY
}

export function serialToDate(serial, { date1904 = false } = {}) {
  // Round to the millisecond to undo floating point noise.
  return new Date(Math.round(serial * MS_PER_DAY) + (date1904 ? EPOCH_1904 : EPOCH_1900))
}

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 can't hold at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e.toLowerCase()]
  })
}

// Attributes of the first tag in a string: '<c r="A1" t="s">' -> { r, t }
export function attrs(tag) {
  const out = {}
  const re = /([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(tag))) out[m[1]] = unescapeXml(m[2] ?? m[3])
  return out
}
