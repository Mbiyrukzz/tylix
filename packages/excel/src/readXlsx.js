// .xlsx bytes -> Workbook with values: numbers, strings (shared, inline
// and rich), booleans, dates (from date number formats), errors and
// formulas (with their cached results), plus merges and column widths.

import { readZip } from './zip.js'
import { attrs, unescapeXml, parseRef, serialToDate } from './refs.js'
import { isDateFormat } from './styles.js'

export async function readXlsx(bytes, Workbook, options = {}) {
  const zip = readZip(bytes)
  const text = async (name) => {
    const entry = zip.get(name)
    return entry ? entry.text() : null
  }
  const wbXml = await text('xl/workbook.xml')
  if (!wbXml) throw new Error('Not an .xlsx workbook (xl/workbook.xml is missing). Old .xls files are not supported.')
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(wbXml)

  const relsXml = (await text('xl/_rels/workbook.xml.rels')) ?? ''
  const rels = new Map()
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0])
    rels.set(a.Id, a.Target)
  }

  const strings = parseSharedStrings((await text('xl/sharedStrings.xml')) ?? '')
  const dateStyles = parseDateStyles((await text('xl/styles.xml')) ?? '')

  const workbook = new Workbook({ date1904 })
  const wanted = options.sheets ? new Set([].concat(options.sheets)) : null
  const sheetTags = [...wbXml.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => attrs(m[0]))
  for (const [index, s] of sheetTags.entries()) {
    if (wanted && !wanted.has(s.name) && !wanted.has(index)) continue
    let target = rels.get(s['r:id']) ?? `worksheets/sheet${index + 1}.xml`
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = (await text(target)) ?? ''
    const sheet = workbook.addSheet(s.name, { autoFilter: false, freeze: false })
    sheet.hidden = s.state === 'hidden' || s.state === 'veryHidden'
    parseSheet(xml, sheet, { strings, dateStyles, date1904, raw: options.raw })
  }
  return workbook
}

function parseSharedStrings(xml) {
  const out = []
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Concatenate every <t> (plain or rich runs), skipping phonetic runs.
    const body = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    let s = ''
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) s += t[1] ? unescapeXml(t[1]) : ''
    out.push(s)
  }
  return out
}

function parseDateStyles(xml) {
  const custom = new Map()
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const a = attrs(m[0])
    custom.set(Number(a.numFmtId), a.formatCode)
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  const result = []
  for (const m of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attrs(m[0]).numFmtId ?? 0)
    result.push(isDateFormat(id, custom.get(id)) ? { date: true, code: custom.get(id) } : null)
  }
  return result
}

function parseSheet(xml, sheet, { strings, dateStyles, date1904, raw }) {
  const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>|<sheetData\b[^>]*\/>/.exec(xml)?.[1] ?? ''
  let rowIndex = -1
  for (const rowMatch of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rowMatch[1])
    rowIndex = ra.r ? Number(ra.r) - 1 : rowIndex + 1
    if (ra.ht && ra.customHeight === '1') sheet.row(rowIndex + 1).height = Number(ra.ht)
    if (ra.hidden === '1') sheet.row(rowIndex + 1).hidden = true
    const body = rowMatch[2]
    if (!body) continue
    let colIndex = -1
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(c[1])
      colIndex = a.r ? parseRef(a.r).col : colIndex + 1
      const inner = c[2] ?? ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
      const type = a.t ?? 'n'
      let value = null
      if (type === 's') value = v != null ? strings[Number(v)] ?? '' : null
      else if (type === 'inlineStr') {
        value = ''
        for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += unescapeXml(t[1])
      } else if (type === 'str') value = v != null ? unescapeXml(v) : ''
      else if (type === 'b') value = v === '1' || v === 'true'
      else if (type === 'e') value = { error: v != null ? unescapeXml(v) : '#ERROR' }
      else if (type === 'd') value = v != null ? new Date(unescapeXml(v)) : null
      else if (v != null && v !== '') {
        value = Number(v)
        const style = dateStyles[Number(a.s ?? 0)]
        if (style?.date && !raw && Number.isFinite(value)) value = serialToDate(value, { date1904 })
      }
      if (value === null && f == null) {
        if (!a.s) continue
      }
      const cell = sheet.cell(rowIndex, colIndex)
      cell.value = f != null ? { formula: unescapeXml(f), result: value } : value
      if (f != null && !raw) cell.formula = unescapeXml(f)
    }
  }
  for (const m of xml.matchAll(/<mergeCell\b[^>]*>/g)) sheet.merges.push(attrs(m[0]).ref)
  for (const m of xml.matchAll(/<col\b[^>]*>/g)) {
    const a = attrs(m[0])
    for (let c = Number(a.min); c <= Number(a.max) && c - Number(a.min) < 256; c++) {
      const p = sheet.column(c - 1)
      if (a.width && a.customWidth === '1') p.width = Number(a.width)
      if (a.hidden === '1') p.hidden = true
    }
  }
  const pane = /<pane\b[^>]*state="frozen"[^>]*>/.exec(xml)
  if (pane) {
    const a = attrs(pane[0])
    sheet.freeze(Number(a.ySplit ?? 0), Number(a.xSplit ?? 0))
  }
  sheet.autoWidth = false
}
