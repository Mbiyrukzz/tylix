// Types for @tylix/pdf.

export type Length = number | `${number}${'pt' | 'px' | 'mm' | 'cm' | 'in'}`
export type Percent = `${number}%`
export type Color = string | [number, number, number] | [number, number, number, number] | { r: number; g: number; b: number; a?: number } | { c: number; m: number; y: number; k: number }
export type Box = Length | [Length, Length] | [Length, Length, Length, Length] | { top?: Length; right?: Length; bottom?: Length; left?: Length; x?: Length; y?: Length }
export type Bytes = Uint8Array | ArrayBuffer | ArrayBufferView
/** Bytes, a data: URL, an http(s) URL, a file path (Node, Deno, Bun) or a Blob. */
export type Source = Bytes | string | Blob
export type PageSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'B4' | 'B5' | 'LETTER' | 'LEGAL' | 'TABLOID' | 'LEDGER' | 'EXECUTIVE' | 'Letter' | 'Legal' | [Length, Length] | { width: Length; height: Length }

export interface TextStyle {
  font?: string
  size?: Length
  bold?: boolean
  italic?: boolean
  color?: Color
  /** A multiplier (1.4) or, above 4, an absolute line height in points. */
  lineHeight?: number
  align?: 'left' | 'center' | 'right' | 'justify'
  characterSpacing?: number
  underline?: boolean
  strike?: boolean
  decorationColor?: Color
  opacity?: number
  /** A URL, "mailto:", or "#id" for a node with that id. */
  link?: string
}

export interface BlockProps extends TextStyle {
  /** Named style(s) from `styles` (built in: h1–h6, small, muted, lead, code, link, caption). */
  style?: string | string[]
  margin?: Box
  marginTop?: Length
  marginRight?: Length
  marginBottom?: Length
  marginLeft?: Length
  padding?: Box
  background?: Color
  border?: number | [number, number, number, number] | { width?: number; color?: Color; dash?: number[]; top?: number; right?: number; bottom?: number; left?: number }
  borderColor?: Color
  radius?: number | [number, number, number, number]
  width?: Length | Percent
  height?: Length
  /** Position of a block narrower than its column. */
  blockAlign?: 'left' | 'center' | 'right'
  /** A destination for "#id" links and tables of contents. */
  id?: string
  pageBreak?: 'before' | 'after'
  /** Move to the next page rather than split. */
  unbreakable?: boolean
  keepWithNext?: boolean
  /** Draw at a fixed spot on the page, outside the flow. */
  absolute?: [Length, Length] | { x: Length; y: Length }
}

export type Span = string | number | (TextStyle & { text: Inline; style?: string | string[]; background?: Color }) | { sup: Inline } | { sub: Inline }
export type Inline = Span | Span[]

export interface TableColumn<Row = any> {
  header?: Content
  key?: string
  width?: Length | Percent | '*' | `${number}*` | 'auto'
  align?: 'left' | 'center' | 'right'
  headerAlign?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  format?: 'number' | 'integer' | 'decimal' | 'currency' | 'percent' | 'date' | 'datetime' | 'time' | ((value: any, row: Row) => Content)
  value?: (row: Row) => any
  style?: TextStyle
  footer?: Content | ((rows: Row[]) => any)
}

export interface TableCell {
  content?: Content
  value?: any
  format?: TableColumn['format']
  colSpan?: number
  background?: Color
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  padding?: Box
}

export interface Table<Row = any> {
  columns?: Array<TableColumn<Row> | string>
  rows?: Row[] | any[][]
  /** Alias of rows. */
  data?: Row[]
  headers?: Content[]
  headerRows?: number
  footer?: any[] | any[][]
  widths?: Array<TableColumn['width']>
  /** Repeat the header on every page (default true). */
  repeatHeader?: boolean
  dontBreakRows?: boolean
  zebra?: boolean | Color
  borders?: 'horizontal' | 'grid' | 'all' | 'outer' | 'none'
  borderColor?: Color
  borderWidth?: number
  radius?: number
  padding?: Box
  fontSize?: Length
  headerStyle?: TextStyle & { background?: Color }
  footerStyle?: TextStyle & { background?: Color }
  cellStyle?: TextStyle
  rowHeight?: Length
  rowBackground?: (index: number) => Color | null
  valign?: 'top' | 'middle' | 'bottom'
  /** Shown when there are no rows (false to show nothing). */
  emptyText?: string | false
}

export interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

export type Node =
  | string
  | number
  | null
  | undefined
  | false
  | Node[]
  | (BlockProps & { text: Inline })
  | (BlockProps & { h1: Inline } & { outline?: boolean; toc?: boolean })
  | (BlockProps & { h2: Inline } & { outline?: boolean; toc?: boolean })
  | (BlockProps & { h3: Inline } & { outline?: boolean; toc?: boolean })
  | (BlockProps & { h4: Inline } & { outline?: boolean; toc?: boolean })
  | (BlockProps & { h5: Inline } & { outline?: boolean; toc?: boolean })
  | (BlockProps & { h6: Inline } & { outline?: boolean; toc?: boolean })
  | (BlockProps & { heading: Inline; level?: 1 | 2 | 3 | 4 | 5 | 6 })
  | (BlockProps & { stack: Node[]; gap?: Length })
  | (BlockProps & { box: Node | Node[] })
  | (BlockProps & { columns: Array<Node | (BlockProps & { width?: Length | Percent | '*' | 'auto' })>; gap?: Length; valign?: 'top' | 'middle' | 'bottom' })
  | (BlockProps & { table: Table })
  | (BlockProps & { ul: Node[]; type?: 'disc' | 'circle' | 'square' | 'dash' | 'check' | 'none'; markerColor?: Color; spacing?: Length })
  | (BlockProps & { ol: Node[]; type?: 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman'; start?: number; markerColor?: Color; spacing?: Length })
  | (BlockProps & { image: Source; fit?: [Length, Length]; opacity?: number; align?: 'left' | 'center' | 'right' })
  | (BlockProps & { svg: string; align?: 'left' | 'center' | 'right'; preserveAspectRatio?: string })
  | (BlockProps & { chart: string | { type: string; data: unknown; options?: Record<string, unknown> }; data?: unknown; options?: Record<string, unknown>; align?: 'left' | 'center' | 'right' })
  | (BlockProps & { qr: string; size?: Length; level?: 'L' | 'M' | 'Q' | 'H'; margin?: number; align?: 'left' | 'center' | 'right' })
  | (BlockProps & { barcode: string; type?: 'code128' | 'ean13' | 'upca' | 'ean8' | 'code39'; height?: Length; fontSize?: Length; align?: 'left' | 'center' | 'right' })
  | (BlockProps & { hr: true | { color?: Color; thickness?: number; dash?: number[] } })
  | { spacer: Length }
  | (BlockProps & { canvas: (painter: Painter, box: CanvasBox) => void; height: Length })
  | (BlockProps & { toc: true | { title?: string | false; levels?: number; leader?: boolean; leaderColor?: Color } })
  | (BlockProps & { html: string })
  | { pageBreak: true; size?: PageSize; orientation?: 'portrait' | 'landscape'; margins?: Box }

export type Content = Node

export interface PageContext {
  page: number
  pages: number
  width: number
  height: number
  margins: [number, number, number, number]
  first: boolean
  last: boolean
}

export interface FontFiles {
  normal?: Source
  bold?: Source
  italic?: Source
  bolditalic?: Source
}

export interface PdfDefinition {
  content: Content
  size?: PageSize
  orientation?: 'portrait' | 'landscape'
  /** Default 56pt (about 2 cm). */
  margins?: Box
  title?: string
  author?: string
  subject?: string
  keywords?: string | string[]
  lang?: string
  info?: { title?: string; author?: string; subject?: string; keywords?: string | string[]; creator?: string; producer?: string; creationDate?: Date }
  /** TrueType / OpenType fonts by family name. */
  fonts?: Record<string, Source | FontFiles>
  /** Families to use for characters the main font can't draw. */
  fallbackFonts?: string[]
  /** Images by name, usable as { image: 'name' }. */
  images?: Record<string, Source>
  defaultStyle?: TextStyle
  styles?: Record<string, BlockProps>
  /** Strings may use {page} and {pages}. */
  header?: Content | ((ctx: PageContext) => Content)
  footer?: Content | ((ctx: PageContext) => Content)
  /** "Page {page} of {pages}" in the footer. */
  pageNumbers?: boolean | { format?: string; align?: 'left' | 'center' | 'right'; size?: Length; color?: Color }
  /** A color, or content drawn behind each page. */
  background?: Color | Content | ((ctx: PageContext) => Content | Color)
  watermark?: string | { text: string; color?: Color; opacity?: number; size?: Length; angle?: number; font?: string; bold?: boolean } | ((ctx: PageContext) => any)
  /** Bookmarks from headings (default true). */
  outline?: boolean
  /** Open the bookmarks panel (default true when there are headings). */
  showOutline?: boolean
  outlineDepth?: number
  /** For table formats (currency, date…). */
  locale?: string
  currency?: string
  timeZone?: string
  /** Resolve relative font / image paths from here. */
  basePath?: string
  /** Pass the @tylix/charts module directly (bundlers, browsers). */
  charts?: unknown
  compress?: boolean
}

export interface TextOptions extends TextStyle {
  width?: number
  style?: string | string[]
}

/** Drawing API for { canvas } nodes. Origin top-left, y grows down, units are points. */
export declare class Painter {
  save(): this
  restore(): this
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this
  translate(x: number, y: number): this
  scale(sx: number, sy?: number, origin?: [number, number]): this
  rotate(degrees: number, cx?: number, cy?: number): this
  lineWidth(w: number): this
  lineCap(cap: 'butt' | 'round' | 'square'): this
  lineJoin(join: 'miter' | 'round' | 'bevel'): this
  miterLimit(m: number): this
  dash(pattern: number | number[] | null, phase?: number): this
  opacity(fill?: number, stroke?: number): this
  fillColor(color: Color): this
  strokeColor(color: Color): this
  moveTo(x: number, y: number): this
  lineTo(x: number, y: number): this
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this
  quadraticCurveTo(cx: number, cy: number, x: number, y: number, from?: [number, number]): this
  closePath(): this
  rect(x: number, y: number, w: number, h: number): this
  roundedRect(x: number, y: number, w: number, h: number, radius?: number | [number, number, number, number]): this
  ellipse(cx: number, cy: number, rx: number, ry?: number): this
  circle(cx: number, cy: number, r: number): this
  polygon(points: Array<[number, number]>, close?: boolean): this
  line(x1: number, y1: number, x2: number, y2: number): this
  /** SVG path data. */
  path(d: string): this
  fill(color?: Color | Gradient, options?: { rule?: 'nonzero' | 'evenodd' }): this
  stroke(color?: Color): this
  fillAndStroke(fill?: Color, stroke?: Color, options?: { rule?: 'nonzero' | 'evenodd' }): this
  clip(rule?: 'nonzero' | 'evenodd'): this
  endPath(): this
  /** Wrapped rich text with its top-left at (x, y); returns the height used. */
  text(content: Inline, x: number, y: number, options?: TextOptions): number
  textWidth(content: Inline, options?: TextOptions): number
  link(target: string | { page: number }, x: number, y: number, w: number, h: number): this
}

export interface Gradient {
  type: 'linear' | 'radial'
  /** 'box' (default): coordinates 0–1 across the path's bounds. 'user': points. */
  units?: 'box' | 'user'
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  cx?: number
  cy?: number
  r?: number
  fx?: number
  fy?: number
  stops: Array<{ offset: number; color: Color; opacity?: number }>
}

export interface SendableResponse {
  setHeader(name: string, value: string): unknown
  end(body?: unknown): unknown
}

export declare class PdfDocument {
  constructor(definition: PdfDefinition | Content)
  /** Pages in the last render. */
  readonly pageCount: number
  /** A Buffer in Node, a Uint8Array elsewhere. */
  toBuffer(): Promise<Uint8Array>
  toUint8Array(): Promise<Uint8Array>
  toBlob(): Promise<Blob>
  toBase64(): Promise<string>
  toDataUrl(): Promise<string>
  /** Write to a file (Node, Deno, Bun). */
  save(path: string): Promise<string>
  /** A fetch Response (route handlers, Hono, Next.js, Deno, Bun). */
  toResponse(filename?: string, options?: { inline?: boolean }): Promise<Response>
  /** Node / Express / Tylix response. */
  send<R extends SendableResponse>(res: R, filename?: string, options?: { inline?: boolean }): Promise<R>
  /** Browser: save as a file. */
  download(filename?: string): Promise<void>
  /** Browser: open in a new tab. */
  open(): Promise<void>
}

export declare function createPdf(definition: PdfDefinition | Content): PdfDocument
export declare function renderPdf(definition: PdfDefinition | Content): Promise<Uint8Array>
export declare function downloadHeaders(filename: string, length: number, inline?: boolean, type?: string): Record<string, string>
export declare function qrMatrix(text: string, options?: { level?: 'L' | 'M' | 'Q' | 'H'; minVersion?: number }): boolean[][]
export declare function barcodeModules(text: string, type?: 'code128' | 'ean13' | 'upca' | 'ean8' | 'code39'): { modules: boolean[]; text: string }
export declare function htmlToNodes(html: string): Node[]
export declare function formatValue(value: unknown, format: TableColumn['format'], options?: { locale?: string; currency?: string; timeZone?: string }, row?: unknown): Content
export declare const PAGE_SIZES: Record<string, [number, number]>
export declare const STANDARD_FONTS: string[]
