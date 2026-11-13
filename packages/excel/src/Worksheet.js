// One sheet: cells, columns, rows and sheet-level features.

import { parseRef, parseRange, rangeRef, columnIndex, columnName, cellRef, toPosition } from './refs.js'

export const DEFAULT_HEADER_STYLE = {
  bold: true,
  fill: '#F3F4F6',
  border: { bottom: { style: 'thin', color: '#9CA3AF' } },
  valign: 'middle',
}

export const DEFAULT_TOTAL_STYLE = {
  bold: true,
  border: { top: { style: 'thin', color: '#9CA3AF' } },
}

const NUMERIC_FORMATS = /^(integer|number|decimal|currency|accounting|percent\d?|date|datetime|time|scientific)$/

const TOTALS = { sum: 'SUM', average: 'AVERAGE', avg: 'AVERAGE', count: 'COUNTA', min: 'MIN', max: 'MAX' }

export class Worksheet {
  constructor(workbook, name, options = {}) {
    this.workbook = workbook
    this.name = validateSheetName(name)
    this.rows = new Map() // row -> Map(col -> cell)
    this.colProps = new Map()
    this.rowProps = new Map()
    this.merges = []
    this.validations = []
    this.conditionals = []
    this.links = []
    this.tables = []
    this.images = []
    this.columns = []
    this.nextRow = 0
    this.pane = null
    this.filter = null
    this.options = options
    this.print = options.print ?? null
    this.tabColor = options.tabColor
    this.hidden = options.hidden ?? false
    this.showGridLines = options.gridLines ?? options.showGridLines ?? true
    this.zoom = options.zoom
    this.rightToLeft = options.rightToLeft ?? false
    this.autoWidth = options.autoWidth ?? true
    if (options.columns) this.setColumns(options.columns, options)
    if (options.rows) this.addRows(options.rows)
    if (options.totals ?? this.columns.some((c) => c.total)) this.addTotals(typeof options.totals === 'object' ? options.totals : {})
    if (options.freeze !== undefined && options.freeze !== 'header') this.freeze(options.freeze)
    else if (this.headerRow != null && options.freeze !== false) this.freeze(this.headerRow + 1, 0)
    if (options.table) this.addTable(options.table === true ? {} : options.table)
    else if (options.autoFilter ?? this.headerRow != null) this.autoFilter(options.autoFilter === true || options.autoFilter === undefined ? undefined : options.autoFilter)
    if (options.merge) for (const m of [].concat(options.merge)) this.merge(m)
  }

  // Cells

  cell(address, col) {
    const { row, col: c } = toPosition(address, col)
    let r = this.rows.get(row)
    if (!r) {
      r = new Map()
      this.rows.set(row, r)
    }
    let cell = r.get(c)
    if (!cell) {
      cell = { value: null, style: null }
      r.set(c, cell)
    }
    if (row >= this.nextRow) this.nextRow = row + 1
    return cell
  }

  set(address, value, style) {
    const cell = this.cell(address)
    cell.value = value
    if (style !== undefined) cell.style = style
    return this
  }

  get(address, col) {
    const { row, col: c } = toPosition(address, col)
    return this.rows.get(row)?.get(c)?.value ?? null
  }

  // Merge a style into existing cells of a range.
  style(range, style) {
    const { start, end } = parseRange(range)
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) {
        const cell = this.cell(r, c)
        cell.style = { ...(cell.style ?? {}), ...style }
      }
    }
    return this
  }

  // Columns

  // columns: [{ header, key, width, format, style, headerStyle, total,
  // value: (row) => any }] or ['Name', 'Email'].
  setColumns(columns, { headerStyle, header = true } = {}) {
    this.columns = columns.map((c, i) => (typeof c === 'string' ? { header: c, key: c } : { ...c, index: i }))
    this.columns.forEach((c, i) => {
      c.index = i
      const props = this.column(i)
      if (c.width != null) props.width = c.width
      if (c.hidden) props.hidden = true
    })
    if (header && this.columns.some((c) => c.header != null)) {
      const row = this.nextRow
      this.columns.forEach((c, i) => {
        const cell = this.cell(row, i)
        cell.value = c.header ?? ''
        cell.style = { ...DEFAULT_HEADER_STYLE, ...(this.workbook.options.headerStyle ?? {}), ...(headerStyle ?? {}), ...(c.headerStyle ?? {}) }
        const align = c.align ?? (NUMERIC_FORMATS.test(c.format ?? '') ? 'right' : null)
        if (align && !cell.style.align) cell.style.align = align
      })
      this.headerRow = row
      this.firstDataRow = row + 1
    } else this.firstDataRow = this.nextRow
    return this
  }

  column(ref) {
    const i = typeof ref === 'number' ? ref : /^\d+$/.test(String(ref)) ? Number(ref) : columnIndex(ref)
    let p = this.colProps.get(i)
    if (!p) {
      p = {}
      this.colProps.set(i, p)
    }
    return p
  }

  row(index) {
    // 1-based like Excel's row numbers.
    let p = this.rowProps.get(index - 1)
    if (!p) {
      p = {}
      this.rowProps.set(index - 1, p)
    }
    return p
  }

  // Rows

  // values: an array (by position) or an object (by column key).
  addRow(values, style) {
    const row = this.nextRow
    const list = Array.isArray(values) ? values : this.columns.length ? this.columns.map((c) => (c.value ? c.value(values) : getPath(values, c.key))) : Object.values(values ?? {})
    list.forEach((v, i) => {
      const col = this.columns[i]
      const cell = this.cell(row, i)
      cell.value = v === undefined ? null : v
      const colStyle = col ? columnStyle(col) : null
      if (colStyle || style) cell.style = { ...(colStyle ?? {}), ...(style ?? {}) }
    })
    if (!list.length) this.nextRow = row + 1
    this.lastDataRow = row
    return row + 1
  }

  addRows(list, style) {
    for (const values of list) this.addRow(values, style)
    return this
  }

  // A totals row under the data, from columns[].total: 'sum' | 'average'
  // | 'count' | 'min' | 'max' | a formula | a label string.
  addTotals({ label = 'Total', style } = {}) {
    if (!this.columns.length) return this
    const first = this.firstDataRow ?? 0
    const last = this.lastDataRow ?? first - 1
    const row = this.nextRow
    const totalStyle = { ...DEFAULT_TOTAL_STYLE, ...(style ?? {}) }
    let labelled = false
    this.columns.forEach((c, i) => {
      const cell = this.cell(row, i)
      const fn = typeof c.total === 'string' ? TOTALS[c.total.toLowerCase()] : null
      if (fn) {
        const range = `${columnName(i)}${first + 1}:${columnName(i)}${Math.max(last + 1, first + 1)}`
        cell.value = { formula: `${fn}(${range})` }
        cell.style = { ...(columnStyle(c) ?? {}), ...totalStyle, ...(fn === 'COUNTA' ? { format: 'integer' } : {}) }
      } else if (typeof c.total === 'function') {
        cell.value = c.total(this.dataRange())
        cell.style = { ...(columnStyle(c) ?? {}), ...totalStyle }
      } else if (c.total && typeof c.total === 'object' && c.total.formula) {
        cell.value = c.total
        cell.style = { ...(columnStyle(c) ?? {}), ...totalStyle }
      } else if (typeof c.total === 'string') {
        cell.value = c.total
        cell.style = totalStyle
        labelled = true
      } else {
        cell.style = totalStyle
      }
    })
    if (!labelled && !this.columns[0].total) this.cell(row, 0).value = label
    this.totalsRow = row
    return this
  }

  dataRange() {
    return { first: (this.firstDataRow ?? 0) + 1, last: (this.lastDataRow ?? 0) + 1 }
  }

  // Sheet features

  merge(range, value, style) {
    const r = parseRange(range)
    this.merges.push(rangeRef(r.start, r.end))
    if (value !== undefined) this.set(cellRef(r.start.row, r.start.col), value, style)
    else if (style) this.style(range, style)
    return this
  }

  // freeze(1) = first row, freeze(1, 1) = first row and column,
  // freeze('B2') = above and left of B2.
  freeze(rows, cols = 0) {
    if (rows === false || rows == null) {
      this.pane = null
      return this
    }
    if (typeof rows === 'string') {
      const p = parseRef(rows)
      this.pane = { row: p.row, col: p.col }
    } else this.pane = { row: rows, col: cols }
    return this
  }

  autoFilter(range) {
    if (range === false) {
      this.filter = null
      return this
    }
    this.filter = range ?? null
    this.filterAuto = range == null
    return this
  }

  // rule: { list: [...] | 'Sheet2!A1:A5' } | { type: 'whole' | 'decimal'
  // | 'date' | 'textLength', between: [a, b] | min | max } | { formula }
  validate(range, rule) {
    this.validations.push({ range, rule })
    return this
  }

  // rule: { type: 'cellIs', operator: '>', value, style }
  //     | { type: 'expression', formula, style }
  //     | { type: 'dataBar', color } | { type: 'colorScale', colors }
  //     | { type: 'duplicate' | 'unique', style } | { type: 'top', rank, style }
  conditionalFormat(range, rule) {
    this.conditionals.push({ range, rule })
    return this
  }

  link(address, target, text, tooltip) {
    const cell = this.cell(address)
    if (text !== undefined) cell.value = text
    else if (cell.value == null) cell.value = target
    cell.link = { target, tooltip }
    return this
  }

  // An Excel table (filter buttons, banded rows, structured refs) over
  // the header + data rows (default: the whole column block).
  addTable({ name, range, style = 'TableStyleMedium2', stripes = true, totals = false } = {}) {
    const ref = range ?? this.tableRange()
    if (!ref) throw new Error('addTable needs a range or columns with a header row')
    this.tables.push({ name, range: ref, style, stripes, totals })
    this.filter = null
    return this
  }

  tableRange() {
    if (this.headerRow == null || !this.columns.length) return null
    const last = Math.max(this.lastDataRow ?? this.headerRow + 1, this.headerRow + 1)
    return `${cellRef(this.headerRow, 0)}:${cellRef(last, this.columns.length - 1)}`
  }

  // source: PNG / JPEG / GIF bytes, a data: URL, a file path or URL.
  // at: 'B2' (top-left cell); width / height in pixels.
  addImage(source, { at = 'A1', width, height, offsetX = 0, offsetY = 0 } = {}) {
    this.images.push({ source, at: toPosition(at), width, height, offsetX, offsetY })
    return this
  }

  // Reading helpers

  get rowCount() {
    let max = -1
    for (const r of this.rows.keys()) if (r > max) max = r
    return max + 1
  }

  get columnCount() {
    let max = 0
    for (const r of this.rows.values()) for (const c of r.keys()) if (c + 1 > max) max = c + 1
    return max
  }

  // All rows as arrays of values (empty cells are null).
  toArrays({ skipEmpty = true } = {}) {
    const out = []
    const width = this.columnCount
    const count = this.rowCount
    for (let r = 0; r < count; r++) {
      const row = this.rows.get(r)
      if (!row && skipEmpty) continue
      const values = new Array(width).fill(null)
      if (row) for (const [c, cell] of row) values[c] = plain(cell.value)
      if (skipEmpty && values.every((v) => v == null || v === '')) continue
      out.push(values)
    }
    return out
  }

  // Rows as objects keyed by the header row.
  toObjects({ headerRow = 1, keys, skipEmpty = true } = {}) {
    const width = this.columnCount
    let header = keys
    if (!header) {
      const row = this.rows.get(headerRow - 1)
      header = Array.from({ length: width }, (_, c) => {
        const v = row?.get(c)?.value
        return v == null || v === '' ? columnName(c) : String(plain(v))
      })
    }
    const out = []
    const count = this.rowCount
    for (let r = keys ? headerRow - 1 : headerRow; r < count; r++) {
      const row = this.rows.get(r)
      if (!row) continue
      const obj = {}
      let empty = true
      header.forEach((key, c) => {
        const v = plain(row.get(c)?.value ?? null)
        if (v != null && v !== '') empty = false
        obj[key] = v
      })
      if (!(skipEmpty && empty)) out.push(obj)
    }
    return out
  }
}

function plain(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result ?? null
    if ('text' in v) return v.text
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    if ('error' in v) return v.error
  }
  return v
}

function columnStyle(col) {
  if (!col.style && !col.format && !col.align && !col.wrap) return null
  return { ...(col.format ? { format: col.format } : {}), ...(col.align ? { align: col.align } : {}), ...(col.wrap ? { wrap: true } : {}), ...(col.style ?? {}) }
}

function getPath(obj, key) {
  if (obj == null || key == null) return undefined
  if (key in obj) return obj[key]
  return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function validateSheetName(name) {
  const n = String(name ?? '').trim()
  if (!n) throw new Error('Sheet names cannot be empty')
  if (n.length > 31) throw new Error(`Sheet name "${n}" is longer than Excel's 31 characters`)
  if (/[\\/?*[\]:]/.test(n)) throw new Error(`Sheet name "${n}" contains a character Excel doesn't allow (\\ / ? * [ ] :)`)
  return n
}
