// Tables: header rows that repeat on every page, body rows that break
// between pages (or inside a row when it's taller than a page), an
// optional footer, zebra striping, column spans and auto widths.

import { Block, StackBlock, RowBlock } from './blocks.js'
import { resolveWidths, nodeKind } from './build.js'
import { box, len, blockOnly } from './style.js'

class TableBlock extends Block {
  constructor({ header, body, footer, width, frame, options }) {
    super()
    this.header = header
    this.body = body
    this.footer = footer
    this.width = width
    this.frame = frame
    this.options = options
    this.height = [...header, ...body, ...footer].reduce((s, r) => s + r.height, 0)
  }

  minHeight() {
    const head = this.header.reduce((s, r) => s + r.height, 0)
    const first = this.body[0] ?? this.footer[0]
    return head + (first ? Math.min(first.height, first.minHeight()) : 0)
  }

  draw(painter, x, y) {
    if (this.id) painter.doc.addDestination(this.id, painter.page, y)
    if (this.outline) painter.doc.addOutline({ ...this.outline, page: painter.page, y })
    const radius = this.options.radius
    if (radius) {
      // Clip row backgrounds to the rounded frame.
      painter.save()
      painter.roundedRect(x, y, this.width, this.height, radius).clip()
    }
    let top = y
    for (const row of [...this.header, ...this.body, ...this.footer]) {
      row.draw(painter, x, top)
      top += row.height
    }
    if (radius) painter.restore()
    if (this.frame) this.frame(painter, x, y, this.width, this.height)
  }

  split(available, { fresh } = {}) {
    const headH = this.header.reduce((s, r) => s + r.height, 0)
    let used = headH
    let count = 0
    for (const row of this.body) {
      if (used + row.height > available + 0.01) break
      used += row.height
      count++
    }
    const repeat = this.options.repeatHeader !== false ? this.header : []
    if (count === this.body.length) {
      // All body rows fit but the footer doesn't: move the last row
      // along with it so the footer isn't alone.
      if (!this.footer.length) return null
      if (count === 0) return null
      count = Math.max(0, count - 1)
      if (count === 0) return null
    }
    let headRows = this.body.slice(0, count)
    let tailRows = this.body.slice(count)
    if (count === 0) {
      // Not even one row fits. Mid-page, move the table to the next page;
      // at the top of a page, split the row itself.
      if (!fresh) return null
      const row = this.body[0]
      const parts = row ? row.split(available - headH, { fresh }) : null
      if (!parts) return null
      headRows = [parts[0]]
      tailRows = [parts[1], ...this.body.slice(1)]
    } else if (count < this.body.length && !this.options.dontBreakRows) {
      // Fill the rest of the page with part of the next row when it's a
      // tall one (more than a third of the page left over).
      const row = this.body[count]
      const room = available - used
      if (row.height > room && room > 40 && row.height > available * 0.6) {
        const parts = row.split(room, { fresh: false })
        if (parts) {
          headRows = [...headRows, parts[0]]
          tailRows = [parts[1], ...this.body.slice(count + 1)]
        }
      }
    }
    const head = new TableBlock({ header: this.header, body: headRows, footer: [], width: this.width, frame: this.frame, options: this.options }).copyMeta(this)
    head.marginBottom = 0
    head.keepWithNext = false
    const tail = new TableBlock({ header: repeat, body: tailRows, footer: this.footer, width: this.width, frame: this.frame, options: this.options }).copyMeta(this)
    tail.marginTop = 0
    tail.id = tail.outline = undefined
    return [head, tail]
  }
}

const FORMATS = {
  number: (v, o) => new Intl.NumberFormat(o.locale, { maximumFractionDigits: 2 }).format(v),
  integer: (v, o) => new Intl.NumberFormat(o.locale, { maximumFractionDigits: 0 }).format(v),
  decimal: (v, o) => new Intl.NumberFormat(o.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v),
  currency: (v, o) => new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency ?? 'USD' }).format(v),
  percent: (v, o) => new Intl.NumberFormat(o.locale, { style: 'percent', maximumFractionDigits: 1 }).format(v),
  date: (v, o) => new Intl.DateTimeFormat(o.locale, { dateStyle: 'medium', timeZone: o.timeZone }).format(toDate(v)),
  datetime: (v, o) => new Intl.DateTimeFormat(o.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: o.timeZone }).format(toDate(v)),
  time: (v, o) => new Intl.DateTimeFormat(o.locale, { timeStyle: 'short', timeZone: o.timeZone }).format(toDate(v)),
}

const toDate = (v) => (v instanceof Date ? v : new Date(v))

export function formatValue(value, format, options, row) {
  if (value == null) return ''
  if (typeof format === 'function') return format(value, row)
  if (typeof format === 'string') {
    const fn = FORMATS[format]
    if (!fn) throw new Error(`Unknown format "${format}". Use ${Object.keys(FORMATS).join(', ')} or a function`)
    if ((format === 'date' || format === 'datetime' || format === 'time') && isNaN(toDate(value))) return String(value)
    if (format !== 'date' && format !== 'datetime' && format !== 'time' && typeof value !== 'number') return String(value)
    return fn(value, options)
  }
  if (value instanceof Date) return FORMATS.date(value, options)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return value
}

const isCellObject = (c) =>
  c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date) && ('content' in c || 'colSpan' in c || 'value' in c || nodeKind(c) !== 'empty')

// Normalize the table spec into { columns, header: [[cells]], body,
// footer } where each cell is { content, colSpan, align, ... }.
function normalize(spec, docOptions) {
  const columns = (spec.columns ?? []).map((c) => (typeof c === 'string' ? { header: c, key: c } : c))
  const rowsSource = spec.rows ?? spec.data ?? spec.body ?? []
  const hasColumns = columns.length > 0
  const toCell = (raw, col = {}, row) => {
    if (isCellObject(raw)) {
      const { colSpan, background, align, valign, padding, content, value, format, ...rest } = raw
      let node = content ?? (value !== undefined ? formatValue(value, format ?? col.format, docOptions, row) : rest)
      if (value === undefined && content === undefined && nodeKind(rest) === 'empty') node = ''
      return { content: node, colSpan: colSpan ?? 1, background, align: align ?? (typeof value === 'number' ? 'right' : undefined), valign, padding, numeric: typeof value === 'number' }
    }
    const formatted = formatValue(raw, col.format, docOptions, row)
    return { content: formatted, colSpan: 1, numeric: typeof raw === 'number' }
  }

  let header = []
  let body = []
  let footer = []
  if (hasColumns) {
    if (columns.some((c) => c.header !== undefined)) header = [columns.map((c) => toCell(c.header ?? ''))]
    body = rowsSource.map((row) =>
      Array.isArray(row) ? row.map((v, i) => toCell(v, columns[i], row)) : columns.map((c) => toCell(c.value ? c.value(row) : getPath(row, c.key), c, row)),
    )
    if (columns.some((c) => c.footer !== undefined)) {
      footer.push(columns.map((c) => {
        const f = typeof c.footer === 'function' ? c.footer(rowsSource) : c.footer
        return toCell(f ?? '', typeof f === 'number' ? c : {}, null)
      }))
    }
  } else {
    const rows = rowsSource.map((row) => (Array.isArray(row) ? row : Object.values(row)))
    const headerRows = spec.headers ? [spec.headers] : rows.splice(0, spec.headerRows ?? 0)
    header = headerRows.map((r) => r.map((v) => toCell(v)))
    body = rows.map((r) => r.map((v) => toCell(v, {}, r)))
    if (!spec.headers && !spec.headerRows && rowsSource.length && !Array.isArray(rowsSource[0])) {
      // Objects without columns: keys become headers.
      header = [Object.keys(rowsSource[0]).map((k) => toCell(humanize(k)))]
    }
  }
  if (spec.footer) {
    const rows = Array.isArray(spec.footer[0]) ? spec.footer : [spec.footer]
    footer.push(...rows.map((r) => r.map((v, i) => toCell(v, columns[i] ?? {}, null))))
  }
  const count = Math.max(
    columns.length,
    ...[...header, ...body, ...footer].map((r) => r.reduce((s, c) => s + (c.colSpan || 1), 0)),
    1,
  )
  return { columns, header, body, footer, count }
}

function getPath(obj, key) {
  if (key == null || obj == null) return undefined
  if (key in obj) return obj[key]
  return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function humanize(key) {
  return String(key).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())
}

function cellPadding(spec) {
  return box(spec.padding ?? [5, 7])
}

export function tableNaturalWidths(builder, spec, style) {
  const t = normalize(spec, builder.doc.options)
  const pad = cellPadding(spec)
  let total = { min: 0, max: 0 }
  for (let i = 0; i < t.count; i++) {
    const n = columnNatural(builder, t, i, style, pad)
    total.min += n.min
    total.max += n.max
  }
  return total
}

function columnNatural(builder, t, i, style, pad) {
  let min = 0
  let max = 0
  const headStyle = { ...style, ...builder.styles.styles.tableHeader }
  for (const [rows, s] of [[t.header, headStyle], [t.body, style], [t.footer, style]]) {
    for (const row of rows) {
      let col = 0
      for (const cell of row) {
        if (col === i && cell.colSpan === 1) {
          const n = builder.natural(cell.content, s)
          min = Math.max(min, n.min)
          max = Math.max(max, n.max)
        }
        col += cell.colSpan
      }
    }
  }
  return { min: min + pad[1] + pad[3] + 0.5, max: max + pad[1] + pad[3] + 0.5 }
}

export function buildTable(builder, spec, width, style, vars) {
  const options = builder.doc.options
  const t = normalize(spec, options)
  const pad = cellPadding(spec)
  const columns = t.columns
  const specs = Array.from({ length: t.count }, (_, i) => spec.widths?.[i] ?? columns[i]?.width ?? 'auto')
  const widths = resolveWidths(specs, width, (i) => columnNatural(builder, t, i, style, pad))
  const xs = []
  widths.reduce((x, w, i) => ((xs[i] = x), x + w), 0)

  const borders = spec.borders ?? spec.border ?? 'horizontal'
  const borderColor = spec.borderColor ?? '#e5e7eb'
  const headerBorderColor = spec.headerBorderColor ?? (borders === 'none' ? null : '#d1d5db')
  const borderWidth = spec.borderWidth ?? 0.75
  const zebra = spec.zebra === true ? '#f9fafb' : spec.zebra || null
  const fontSize = spec.fontSize
  const tableStyle = fontSize ? { ...style, size: fontSize } : style
  const headStyle = { ...tableStyle, ...builder.styles.named('tableHeader'), ...builder.styles.named(spec.headerStyleName), ...(spec.headerStyle ?? {}) }
  const footStyle = { ...tableStyle, ...builder.styles.named('tableFooter'), ...(spec.footerStyle ?? {}) }
  const bodyStyle = { ...tableStyle, ...(spec.cellStyle ?? {}) }

  const buildRow = (cells, rowStyle, kind, index) => {
    let col = 0
    const rowCells = []
    for (const cell of cells) {
      if (col >= t.count) break
      const span = Math.min(cell.colSpan, t.count - col)
      const x = xs[col]
      const w = widths.slice(col, col + span).reduce((s, v) => s + v, 0)
      const colDef = columns[col] ?? {}
      const p = cell.padding ? box(cell.padding) : pad
      const align =
        cell.align ??
        (kind === 'header' ? colDef.headerAlign ?? colDef.align : colDef.align) ??
        (cell.numeric || (kind === 'header' && isNumericColumn(t, col)) ? 'right' : undefined)
      const cs = { ...blockOnly(rowStyle), ...(kind === 'body' && colDef.style ? colDef.style : {}) }
      if (align) cs.align = align
      const block = builder.build(cell.content, Math.max(1, w - p[1] - p[3]), cs, vars) ?? builder.paragraph('', w - p[1] - p[3], cs)
      let background = cell.background ?? (kind === 'header' ? headStyle.background : kind === 'footer' ? footStyle.background : null)
      if (!background && kind === 'body' && zebra && index % 2 === 1) background = zebra
      if (!background && kind === 'body' && spec.rowBackground) background = spec.rowBackground(index)
      rowCells.push({ block: new StackBlock([block]), x, width: w, padding: p, background, valign: cell.valign ?? spec.valign ?? colDef.valign })
      col += span
    }
    const row = new RowBlock(rowCells, { minHeight: len(spec.rowHeight) ?? 0 })
    if (spec.dontBreakRows) row.unbreakable = true
    row.drawBorders = (painter, x, y, h) => {
      if (borders === 'none') return
      painter.save().lineWidth(borderWidth)
      const isHeader = kind === 'header'
      if (borders === 'horizontal' || borders === 'grid' || borders === 'all') {
        painter.line(x, y + h, x + width, y + h).stroke(isHeader && headerBorderColor ? headerBorderColor : borderColor)
      }
      if (kind === 'footer' && borders !== 'outer') painter.line(x, y, x + width, y).stroke(headerBorderColor ?? borderColor)
      if (borders === 'grid' || borders === 'all') {
        for (const c of rowCells.slice(1)) painter.line(x + c.x, y, x + c.x, y + h).stroke(borderColor)
      }
      painter.restore()
    }
    return row
  }

  const header = t.header.map((cells) => buildRow(cells, headStyle, 'header'))
  let body = t.body.map((cells, i) => buildRow(cells, bodyStyle, 'body', i))
  const footer = t.footer.map((cells) => buildRow(cells, footStyle, 'footer'))
  if (!body.length && spec.emptyText !== false && spec.emptyText !== null) {
    body = [buildRow([{ content: { text: spec.emptyText ?? 'No data', color: '#6b7280', align: 'center' }, colSpan: t.count }], bodyStyle, 'body', 0)]
  }

  const radius = len(spec.radius) ?? 0
  const frame =
    borders === 'grid' || borders === 'all' || borders === 'outer'
      ? (p, x, y, w, h) => {
          p.save().lineWidth(borderWidth)
          if (radius) p.roundedRect(x + borderWidth / 2, y + borderWidth / 2, w - borderWidth, h - borderWidth, radius).stroke(borderColor)
          else p.rect(x, y, w, h).stroke(borderColor)
          p.restore()
        }
      : null

  return new TableBlock({
    header,
    body,
    footer,
    width,
    frame,
    options: { repeatHeader: spec.repeatHeader, dontBreakRows: spec.dontBreakRows, radius: frame ? radius : 0 },
  })
}

function isNumericColumn(t, col) {
  if (!t.body.length) return false
  return t.body.every((row) => {
    let c = 0
    for (const cell of row) {
      if (c === col) return cell.numeric || cell.content === ''
      c += cell.colSpan
    }
    return true
  })
}
