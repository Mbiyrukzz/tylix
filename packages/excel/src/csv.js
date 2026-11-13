// CSV (RFC 4180) parsing and writing.

// Values starting with these are run as formulas by spreadsheet apps.
const FORMULA_START = /^[=+\-@\t\r]/

// text -> rows. With header: true (default), rows are objects keyed by
// the first line. delimiter is detected (comma, semicolon, tab, pipe)
// unless given. types: true turns numbers, booleans and empty strings
// into numbers, booleans and null.
export function parseCsv(text, { header = true, delimiter, types = false, trim = false, skipEmpty = true, columns } = {}) {
  let src = String(text)
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)
  const d = delimiter ?? detectDelimiter(src)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let i = 0
  const n = src.length
  const pushField = () => {
    row.push(quoted ? field : trim ? field.trim() : field)
    field = ''
    quoted = false
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < n) {
    const ch = src[i]
    if (ch === '"' && field === '' && !quoted) {
      // Quoted field.
      quoted = true
      i++
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            field += '"'
            i += 2
            continue
          }
          i++
          break
        }
        field += src[i++]
      }
      // Anything between the closing quote and the delimiter is kept.
      while (i < n && src[i] !== d && src[i] !== '\n' && src[i] !== '\r') field += src[i++]
      continue
    }
    if (ch === d) {
      pushField()
      i++
      continue
    }
    if (ch === '\n' || ch === '\r') {
      pushRow()
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || quoted || row.length) pushRow()

  let list = skipEmpty ? rows.filter((r) => !(r.length === 1 && r[0] === '')) : rows
  if (types) list = list.map((r) => r.map(convert))
  if (!header && !columns) return list
  const keys = columns ?? list.shift()?.map((k, idx) => String(k ?? '').trim() || `column${idx + 1}`) ?? []
  return list.map((r) => Object.fromEntries(keys.map((k, idx) => [k, r[idx] ?? (types ? null : '')])))
}

function convert(v) {
  if (v === '') return null
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true'
  if (/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v) && !/^-?0\d/.test(v)) return Number(v)
  return v
}

function detectDelimiter(text) {
  const sample = text.slice(0, 4096).split(/\r?\n/).slice(0, 5)
  let best = ','
  let bestScore = -1
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((line) => countOutsideQuotes(line, d)).filter((c) => c > 0)
    if (!counts.length) continue
    const consistent = counts.every((c) => c === counts[0])
    const score = counts[0] * (consistent ? 2 : 1)
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

function countOutsideQuotes(line, d) {
  let n = 0
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === d && !q) n++
  }
  return n
}

// rows (objects or arrays) -> CSV text.
//   columns: ['name', { key: 'total', header: 'Total', format: (v) => … }]
//   bom: true prefixes a byte-order mark so Excel reads UTF-8 correctly.
//   escapeFormulas (default true) prefixes values that would run as
//   formulas with ' (CSV injection protection).
export function toCsv(rows, { columns, delimiter = ',', header = true, bom = false, eol = '\r\n', escapeFormulas = true, dates = 'iso' } = {}) {
  const list = [...rows]
  let cols = columns?.map((c) => (typeof c === 'string' ? { key: c, header: c } : { header: c.key, ...c }))
  if (!cols && list.length && !Array.isArray(list[0])) {
    const keys = []
    for (const r of list) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
    cols = keys.map((k) => ({ key: k, header: k }))
  }
  const cell = (v) => {
    if (v == null) return ''
    let s
    if (v instanceof Date) s = isNaN(v) ? '' : dates === 'iso' ? v.toISOString() : typeof dates === 'function' ? dates(v) : v.toISOString().slice(0, 10)
    else if (typeof v === 'object') s = JSON.stringify(v)
    else s = String(v)
    if (escapeFormulas && typeof v === 'string' && FORMULA_START.test(s) && !/^-?\d/.test(s)) s = "'" + s
    if (s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = []
  if (cols) {
    if (header) lines.push(cols.map((c) => cell(c.header ?? c.key)).join(delimiter))
    for (const r of list) {
      lines.push(
        cols
          .map((c) => {
            const raw = Array.isArray(r) ? r[cols.indexOf(c)] : c.value ? c.value(r) : r[c.key]
            return cell(c.format ? c.format(raw, r) : raw)
          })
          .join(delimiter),
      )
    }
  } else for (const r of list) lines.push(r.map(cell).join(delimiter))
  return (bom ? '﻿' : '') + lines.join(eol) + (lines.length ? eol : '')
}
