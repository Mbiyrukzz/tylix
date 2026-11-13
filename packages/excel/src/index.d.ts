// Types for @tylix/excel.

export type Bytes = Uint8Array | ArrayBuffer | ArrayBufferView
/** Bytes, a Blob, a data: URL, an http(s) URL or a file path (Node, Deno, Bun). */
export type Source = Bytes | Blob | string
/** 'B3', [row, col] (zero-based) or { row, col }. */
export type Address = string | [number, number] | { row: number; col: number }

export type NamedFormat =
  | 'general' | 'integer' | 'number' | 'decimal' | 'currency' | 'accounting'
  | 'percent' | 'percent1' | 'percent2' | 'date' | 'datetime' | 'time' | 'text' | 'scientific'

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair'
export type BorderSide = boolean | BorderStyle | string | { style?: BorderStyle; color?: string }

export interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean | 'double'
  strike?: boolean
  font?: string
  size?: number
  color?: string
  fill?: string
  /** Alias of fill. */
  background?: string
  align?: 'left' | 'center' | 'right' | 'fill' | 'justify'
  valign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  indent?: number
  rotate?: number
  shrink?: boolean
  border?: true | BorderStyle | { style?: BorderStyle; color?: string; top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide }
  /** A named format or an Excel format code like '0.000' or 'dd/mm/yyyy'. */
  format?: NamedFormat | string
}

export type CellValue =
  | string
  | number
  | boolean
  | Date
  | bigint
  | null
  | { formula: string; result?: string | number | boolean | null }
  | { text: string; link: string; tooltip?: string }
  | { richText: Array<{ text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; size?: number; font?: string }> }
  | { error: string }

export interface Cell {
  value: CellValue
  style: CellStyle | null
  link?: { target: string; tooltip?: string }
  /** Set on cells read from a file. */
  formula?: string
}

export interface Column<Row = any> {
  header?: string
  key?: string
  /** Width in characters. Columns size to their content by default. */
  width?: number
  format?: NamedFormat | string
  align?: CellStyle['align']
  wrap?: boolean
  style?: CellStyle
  headerStyle?: CellStyle
  hidden?: boolean
  value?: (row: Row) => CellValue
  /** A totals row under the data. */
  total?: 'sum' | 'average' | 'avg' | 'count' | 'min' | 'max' | string | { formula: string } | ((range: { first: number; last: number }) => CellValue)
}

export interface PrintSetup {
  orientation?: 'portrait' | 'landscape'
  paper?: 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal'
  fitToWidth?: boolean
  fitToPage?: boolean
  /** Repeat the header row on every printed page. */
  repeatHeader?: boolean
  gridLines?: boolean
  center?: boolean
  margins?: { left?: number; right?: number; top?: number; bottom?: number; header?: number; footer?: number }
  /** Text with {page}, {pages}, {sheet}, {date}; a string is centered. */
  header?: string | { left?: string; center?: string; right?: string }
  footer?: string | { left?: string; center?: string; right?: string }
}

export interface SheetOptions<Row = any> {
  columns?: Array<Column<Row> | string>
  rows?: Array<Row | CellValue[]>
  headerStyle?: CellStyle
  /** Default: freeze the header row. false, a cell ('B2') or a row count. */
  freeze?: false | 'header' | string | number
  /** Default: on when there's a header row. */
  autoFilter?: boolean | string
  /** Make the data an Excel table (banded rows, filter buttons). */
  table?: boolean | TableOptions
  /** Add a totals row (also on when a column has `total`). */
  totals?: boolean | { label?: string; style?: CellStyle }
  merge?: string | string[]
  tabColor?: string
  hidden?: boolean
  gridLines?: boolean
  zoom?: number
  rightToLeft?: boolean
  /** Size columns to their content (default true). */
  autoWidth?: boolean
  print?: PrintSetup
}

export interface TableOptions {
  name?: string
  range?: string
  /** e.g. TableStyleLight9, TableStyleMedium2 (default), TableStyleDark1. */
  style?: string
  stripes?: boolean
}

export type ValidationRule =
  | { list: Array<string | number> | string; allowBlank?: boolean; strict?: boolean; error?: string; errorTitle?: string; prompt?: string; promptTitle?: string }
  | { type?: 'whole' | 'decimal' | 'date' | 'time' | 'textLength'; between?: [number | Date, number | Date]; min?: number | Date; max?: number | Date; allowBlank?: boolean; strict?: boolean; error?: string; errorTitle?: string; prompt?: string; promptTitle?: string }
  | { formula: string; allowBlank?: boolean; strict?: boolean; error?: string; errorTitle?: string; prompt?: string; promptTitle?: string }

export type ConditionalRule =
  | { type?: 'cellIs'; operator: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'between' | 'notBetween'; value: unknown; style?: CellStyle }
  | { type?: 'expression'; formula: string; style?: CellStyle }
  | { type: 'contains'; text: string; style?: CellStyle }
  | { type: 'duplicate' | 'unique'; style?: CellStyle }
  | { type: 'top' | 'bottom'; rank?: number; percent?: boolean; style?: CellStyle }
  | { type: 'dataBar'; color?: string }
  | { type: 'colorScale'; colors?: [string, string] | [string, string, string] }

export declare class Worksheet<Row = any> {
  readonly name: string
  readonly rowCount: number
  readonly columnCount: number
  print: PrintSetup | null
  tabColor?: string
  hidden: boolean
  showGridLines: boolean
  /** The cell at an address (created if missing). */
  cell(address: Address): Cell
  cell(row: number, col: number): Cell
  set(address: Address, value: CellValue, style?: CellStyle): this
  get(address: Address): CellValue
  get(row: number, col: number): CellValue
  /** Merge a style into every cell of a range. */
  style(range: string, style: CellStyle): this
  setColumns(columns: Array<Column<Row> | string>, options?: { headerStyle?: CellStyle; header?: boolean }): this
  /** Column props by letter or zero-based index. */
  column(ref: string | number): { width?: number; hidden?: boolean; style?: CellStyle; outline?: number }
  /** Row props by 1-based row number. */
  row(index: number): { height?: number; hidden?: boolean; style?: CellStyle; outline?: number }
  /** Append a row (an object by column key, or an array). Returns its 1-based row number. */
  addRow(values: Row | CellValue[], style?: CellStyle): number
  addRows(rows: Array<Row | CellValue[]>, style?: CellStyle): this
  addTotals(options?: { label?: string; style?: CellStyle }): this
  merge(range: string, value?: CellValue, style?: CellStyle): this
  freeze(rows: number | string | false, cols?: number): this
  autoFilter(range?: string | false): this
  validate(range: string, rule: ValidationRule): this
  conditionalFormat(range: string, rule: ConditionalRule): this
  /** URL, mailto:, or "#Sheet!A1" for a spot in the workbook. */
  link(address: Address, target: string, text?: string, tooltip?: string): this
  addTable(options?: TableOptions): this
  addImage(source: Source, options?: { at?: Address; width?: number; height?: number; offsetX?: number; offsetY?: number }): this
  toArrays(options?: { skipEmpty?: boolean }): CellValue[][]
  toObjects<T = Record<string, any>>(options?: { headerRow?: number; keys?: string[]; skipEmpty?: boolean }): T[]
}

export interface WorkbookOptions {
  title?: string
  subject?: string
  creator?: string
  author?: string
  company?: string
  keywords?: string | string[]
  description?: string
  created?: Date
  /** For the 'currency' format (default USD). */
  currency?: string
  /** Default font and size (Calibri 11). */
  font?: string
  fontSize?: number
  headerStyle?: CellStyle
  /** 'utc' (default) writes dates as their UTC time; 'local' keeps the local wall-clock time. */
  dateMode?: 'utc' | 'local'
  date1904?: boolean
  defaultColumnWidth?: number
  basePath?: string
  compress?: boolean
}

export interface SendableResponse {
  setHeader(name: string, value: string): unknown
  end(body?: unknown): unknown
}

export declare class Workbook {
  constructor(options?: WorkbookOptions)
  readonly sheets: Worksheet[]
  properties: { title?: string; subject?: string; creator?: string; company?: string; keywords?: string | string[]; description?: string; created?: Date }
  activeSheet: number
  addSheet<Row = any>(name?: string, options?: SheetOptions<Row>): Worksheet<Row>
  sheet(nameOrIndex?: string | number): Worksheet | null
  removeSheet(nameOrIndex: string | number): this
  defineName(name: string, ref: string): this
  /** A Buffer in Node, a Uint8Array elsewhere. */
  toBuffer(): Promise<Uint8Array>
  toUint8Array(): Promise<Uint8Array>
  toBlob(): Promise<Blob>
  toBase64(): Promise<string>
  /** .xlsx, or CSV of the first sheet when the path ends in .csv. */
  save(path: string): Promise<string>
  toResponse(filename?: string): Promise<Response>
  send<R extends SendableResponse>(res: R, filename?: string): Promise<R>
  download(filename?: string): Promise<void>
  toCsv(options?: CsvWriteOptions & { sheet?: string | number }): string
}

export interface CsvParseOptions {
  /** Objects keyed by the first line (default true). */
  header?: boolean
  columns?: string[]
  /** Detected by default (comma, semicolon, tab, pipe). */
  delimiter?: string
  /** Convert numbers, booleans and empty strings (default false). */
  types?: boolean
  trim?: boolean
  skipEmpty?: boolean
}

export interface CsvWriteOptions {
  columns?: Array<string | { key: string; header?: string; format?: (value: any, row: any) => unknown; value?: (row: any) => unknown }>
  delimiter?: string
  header?: boolean
  /** Byte-order mark so Excel reads UTF-8 (default false). */
  bom?: boolean
  eol?: string
  /** Prefix values that would run as formulas with ' (default true). */
  escapeFormulas?: boolean
  dates?: 'iso' | 'date' | ((date: Date) => string)
}

export declare function createWorkbook(options?: WorkbookOptions): Workbook
export declare function readWorkbook(source: Source, options?: { sheets?: string | number | Array<string | number>; raw?: boolean; basePath?: string; types?: boolean; delimiter?: string; sheetName?: string }): Promise<Workbook>
export declare function toXlsx<Row = any>(rows: Row[] | Record<string, Row[] | SheetOptions<Row>>, options?: WorkbookOptions & SheetOptions<Row> & { sheet?: string }): Promise<Uint8Array>
export declare function fromXlsx<T = Record<string, any>>(source: Source, options?: { sheet?: string | number; headerRow?: number; raw?: boolean; basePath?: string }): Promise<T[]>
export declare function parseCsv(text: string, options: CsvParseOptions & { header: false }): any[][]
export declare function parseCsv<T = Record<string, any>>(text: string, options?: CsvParseOptions): T[]
export declare function toCsv(rows: Array<Record<string, unknown> | unknown[]>, options?: CsvWriteOptions): string
export declare function downloadHeaders(filename: string, length: number, type: string): Record<string, string>
export declare const XLSX_TYPE: string
export declare function columnName(index: number): string
export declare function columnIndex(name: string): number
export declare function parseRef(ref: string): { row: number; col: number }
export declare function cellRef(row: number, col: number): string
export declare function parseRange(range: string): { start: { row: number; col: number }; end: { row: number; col: number } }
export declare function dateToSerial(date: Date, options?: { date1904?: boolean; local?: boolean }): number
export declare function serialToDate(serial: number, options?: { date1904?: boolean }): Date
export declare function formatCode(format: string, options?: { currency?: string }): string | null
