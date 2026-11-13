// Workbook: sheets + output (buffer, file, download, HTTP response).

import { Worksheet } from './Worksheet.js'
import { writeXlsx } from './writeXlsx.js'
import { readXlsx } from './readXlsx.js'
import { parseCsv, toCsv } from './csv.js'
import { loadSource } from './source.js'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export class Workbook {
  constructor(options = {}) {
    this.options = options
    this.sheets = []
    this.names = []
    this.properties = {
      title: options.title,
      subject: options.subject,
      creator: options.creator ?? options.author,
      company: options.company,
      keywords: options.keywords,
      description: options.description,
      created: options.created,
    }
    this.activeSheet = 0
  }

  // addSheet('Orders', { columns, rows, freeze, table, autoFilter, … })
  addSheet(name, options = {}) {
    const base = name ?? `Sheet${this.sheets.length + 1}`
    if (this.sheets.some((s) => s.name.toLowerCase() === String(base).toLowerCase())) throw new Error(`A sheet named "${base}" already exists`)
    const sheet = new Worksheet(this, base, options)
    this.sheets.push(sheet)
    return sheet
  }

  sheet(nameOrIndex = 0) {
    if (typeof nameOrIndex === 'number') return this.sheets[nameOrIndex] ?? null
    return this.sheets.find((s) => s.name === nameOrIndex) ?? this.sheets.find((s) => s.name.toLowerCase() === String(nameOrIndex).toLowerCase()) ?? null
  }

  removeSheet(nameOrIndex) {
    const s = this.sheet(nameOrIndex)
    if (s) this.sheets.splice(this.sheets.indexOf(s), 1)
    return this
  }

  // A named range: defineName('TaxRate', 'Settings!$B$2').
  defineName(name, ref) {
    this.names.push({ name, ref })
    return this
  }

  // Outputs

  async toUint8Array() {
    return writeXlsx(this)
  }

  async toBuffer() {
    const bytes = await this.toUint8Array()
    return globalThis.Buffer ? globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes
  }

  async toBlob() {
    return new Blob([await this.toUint8Array()], { type: XLSX_TYPE })
  }

  async toBase64() {
    const bytes = await this.toUint8Array()
    if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString('base64')
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  async save(path) {
    const fs = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await fs.mkdir(dirname(path), { recursive: true })
    if (/\.csv$/i.test(path)) await fs.writeFile(path, this.toCsv({ bom: true }))
    else await fs.writeFile(path, await this.toBuffer())
    return path
  }

  async toResponse(filename = 'workbook.xlsx') {
    const bytes = await this.toUint8Array()
    return new Response(bytes, { headers: downloadHeaders(filename, bytes.length, XLSX_TYPE) })
  }

  async send(res, filename = 'workbook.xlsx') {
    const bytes = await this.toBuffer()
    for (const [k, v] of Object.entries(downloadHeaders(filename, bytes.length, XLSX_TYPE))) res.setHeader(k, v)
    res.end(bytes)
    return res
  }

  async download(filename = 'workbook.xlsx') {
    const url = URL.createObjectURL(await this.toBlob())
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  // One sheet as CSV.
  toCsv(options = {}) {
    const sheet = this.sheet(options.sheet ?? 0)
    if (!sheet) throw new Error('No such sheet')
    return toCsv(sheet.toArrays(), { ...options, header: false })
  }
}

export function downloadHeaders(filename, length, type) {
  const safe = String(filename).replace(/["\\\r\n]/g, '_')
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_')
  return {
    'Content-Type': type,
    'Content-Length': String(length),
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    'Cache-Control': 'private, no-cache',
  }
}

export function createWorkbook(options) {
  return new Workbook(options)
}

// source: bytes, a Blob, a URL or a file path (.xlsx or .csv).
export async function readWorkbook(source, options = {}) {
  const isCsvPath = typeof source === 'string' && /\.(csv|tsv|txt)$/i.test(source)
  const bytes = await loadSource(source, options.basePath)
  const looksLikeZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!looksLikeZip || isCsvPath) {
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('This is an old .xls file. Save it as .xlsx (or .csv) first.')
    const wb = new Workbook()
    const sheet = wb.addSheet(options.sheetName ?? 'Sheet1', { autoFilter: false, freeze: false })
    const rows = parseCsv(new TextDecoder().decode(bytes), { header: false, types: options.types ?? true, delimiter: options.delimiter })
    rows.forEach((r) => sheet.addRow(r))
    return wb
  }
  return readXlsx(bytes, Workbook, options)
}

// The one-liners.

// rows -> .xlsx Buffer. options: { sheet: 'Name', columns, … sheet
// options } or sheets: { Name: rows | { rows, columns, … } }.
export async function toXlsx(rows, options = {}) {
  const wb = new Workbook(options)
  if (rows && !Array.isArray(rows) && typeof rows === 'object') {
    for (const [name, spec] of Object.entries(rows)) {
      wb.addSheet(name, Array.isArray(spec) ? { rows: spec, columns: options.columns ?? columnsFor(spec) } : { ...spec, columns: spec.columns ?? columnsFor(spec.rows ?? []) })
    }
  } else {
    const { sheet = 'Sheet1', ...rest } = options
    wb.addSheet(sheet, { ...rest, rows, columns: rest.columns ?? columnsFor(rows) })
  }
  return wb.toBuffer()
}

// .xlsx / .csv -> array of objects keyed by the header row.
export async function fromXlsx(source, { sheet = 0, headerRow = 1, raw = false, ...options } = {}) {
  const wb = await readWorkbook(source, { ...options, raw })
  const s = wb.sheet(sheet)
  if (!s) throw new Error(`No sheet "${sheet}" in this workbook (${wb.sheets.map((x) => x.name).join(', ')})`)
  return s.toObjects({ headerRow })
}

function columnsFor(rows) {
  if (!rows.length || Array.isArray(rows[0])) return undefined
  const keys = []
  for (const r of rows.slice(0, 1000)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
  return keys.map((k) => ({ header: humanize(k), key: k }))
}

function humanize(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase())
}

export { parseCsv, toCsv }
