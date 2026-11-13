// createPdf(definition) -> PdfDocument. Lays the content out into pages
// and writes the PDF.

import { PdfWriter } from './writer/PdfWriter.js'
import { Resources } from './graphics/Resources.js'
import { Painter } from './graphics/Painter.js'
import { FontRegistry } from './fonts/FontRegistry.js'
import { StyleSheet, pageSize, box, len, DEFAULT_STYLE } from './layout/style.js'
import { Builder, nodeKind } from './layout/build.js'
import { TextBlock, containsBreak } from './layout/blocks.js'
import { breakLines } from './layout/text.js'
import { htmlToNodes } from './html/htmlToNodes.js'
import { ImageStore, loadSource, isBytes } from './assets.js'
import { isDataUrl } from './util/bytes.js'
import { pdfDate } from './writer/objects.js'

const DEFAULT_MARGINS = 56 // ~2 cm

export class PdfDocument {
  constructor(definition = {}) {
    if (Array.isArray(definition) || typeof definition === 'string') definition = { content: definition }
    this.definition = definition
    this.options = {
      locale: definition.locale,
      currency: definition.currency,
      timeZone: definition.timeZone,
    }
    this.styles = new StyleSheet(definition.styles, { ...DEFAULT_STYLE, ...(definition.defaultStyle ?? {}) })
    this.fonts = new FontRegistry()
    this.images = new ImageStore()
    this.outlineEnabled = definition.outline !== false
    this.rendered = null
    this.pageCount = 0
  }

  // Load fonts, images and (if used) @tylix/charts once.
  async prepare() {
    if (this.prepared) return
    const def = this.definition
    const base = def.basePath
    if (def.fonts) {
      for (const [family, files] of Object.entries(def.fonts)) {
        const entries = typeof files === 'string' || isBytes(files) ? { normal: files } : files
        const loaded = {}
        for (const [variant, src] of Object.entries(entries)) if (src) loaded[variant] = await loadSource(src, base)
        this.fonts.register(family, loaded)
      }
    }
    this.fonts.fallbacks = (def.fallbackFonts ?? []).filter((f) => this.fonts.has(f))

    // Expand { html } nodes now so their images are found below.
    this.content = expandHtml(def.content ?? [], this)
    const sources = new Set()
    let usesCharts = false
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(visit)
      if (typeof node.image === 'string' && !isDataUrl(node.image)) sources.add(node.image)
      if ('chart' in node) usesCharts = true
      for (const [k, v] of Object.entries(node)) if (k !== 'image' && typeof v === 'object') visit(v)
    }
    visit(this.content)
    for (const key of ['header', 'footer', 'background']) if (typeof def[key] === 'object') visit(def[key])
    for (const [name, src] of Object.entries(def.images ?? {})) this.images.set(name, await loadSource(src, base))
    await Promise.all(
      [...sources]
        .filter((s) => !this.images.has(s))
        .map(async (s) => this.images.set(s, await loadSource(s, base))),
    )
    if (usesCharts || def.charts) {
      if (def.charts && typeof def.charts === 'object') this.charts = def.charts
      else {
        try {
          this.charts = await import('@tylix/charts')
        } catch {
          throw new Error('{ chart } nodes need @tylix/charts: npm install @tylix/charts')
        }
      }
    }
    this.prepared = true
  }

  // Page geometry for a set of page options.
  pageSetup(opts = {}) {
    const def = this.definition
    const [width, height] = pageSize(opts.size ?? def.size ?? def.pageSize ?? 'A4', opts.orientation ?? def.orientation ?? def.pageOrientation)
    const margins = box(opts.margins ?? def.margins ?? def.pageMargins ?? DEFAULT_MARGINS)
    return { width, height, margins }
  }

  newPage(setup) {
    const page = {
      index: this.pages.length,
      ...setup,
      annotations: [],
      ref: this.writer.alloc(),
    }
    page.painter = new Painter(this, page)
    this.pages.push(page)
    this.bodyHeight = setup.height - setup.margins[0] - setup.margins[2]
    return page
  }

  addDestination(id, page, y) {
    if (!this.destinations.has(id)) this.destinations.set(id, { page, y })
  }

  addOutline(entry) {
    this.outlines.push(entry)
  }

  // A text block for canvas callbacks (painter.text()).
  layoutText(content, options = {}) {
    const style = { ...this.styles.defaults, ...this.styles.named(options.style), ...options }
    const runs = this.builder.runs(content, style)
    const width = options.width ?? Infinity
    return new TextBlock(breakLines(runs, width, { lineHeight: style.lineHeight }), { align: style.align, width: Number.isFinite(width) ? width : 0 })
  }

  layoutPass(tocEntries) {
    this.writer = new PdfWriter({ compress: this.definition.compress !== false })
    this.resources = new Resources(this.writer)
    for (const font of this.fonts.allFonts()) font.ref = null
    for (const img of this.images.all()) img.ref = null
    this.pages = []
    this.destinations = new Map()
    this.outlines = []
    this.tocEntries = tocEntries
    this.builder = new Builder(this)
    const defaults = this.styles.defaults

    for (const section of sections(this.content)) {
      const setup = this.pageSetup(section.options)
      let page = this.newPage(setup)
      const bodyWidth = setup.width - setup.margins[1] - setup.margins[3]
      let block = this.builder.build({ stack: section.nodes }, bodyWidth, defaults)
      if (!block) continue
      const x = setup.margins[3]
      const top = setup.margins[0]
      const bottom = setup.height - setup.margins[2]
      let y = top
      let guard = 0
      while (block && (block.height > 0 || block.children?.some((c) => c.absolute))) {
        if (++guard > 100000) throw new Error('Layout did not converge')
        const available = bottom - y
        if (block.height <= available + 0.01 && !containsBreak(block)) {
          block.draw(page.painter, x, y)
          break
        }
        const parts = block.split(available, { fresh: y === top })
        if (parts) {
          parts[0].draw(page.painter, x, y)
          block = parts[1]
          if (!block || (block.height <= 0 && !block.children?.some((c) => c.absolute))) break
          page = this.newPage(setup)
          y = top
          continue
        }
        if (y === top) {
          // Nothing else to try: draw it and let it overflow.
          block.draw(page.painter, x, y)
          break
        }
        page = this.newPage(setup)
        y = top
      }
    }
    if (!this.pages.length) this.newPage(this.pageSetup())
    this.decoratePages()
  }

  // Backgrounds, headers, footers and watermarks, now that the page
  // count is known.
  decoratePages() {
    const def = this.definition
    const total = this.pages.length
    for (const page of this.pages) {
      const vars = { page: page.index + 1, pages: total }
      const ctx = { ...vars, width: page.width, height: page.height, margins: page.margins, first: page.index === 0, last: page.index === total - 1 }
      const bodyWidth = page.width - page.margins[1] - page.margins[3]
      const under = new Painter(this, page)
      const over = new Painter(this, page)
      const resolve = (v) => (typeof v === 'function' ? v(ctx) : v)

      const background = resolve(def.background)
      if (background) {
        if (typeof background === 'string' && !background.includes(' ')) {
          under.rect(0, 0, page.width, page.height).fill(background)
        } else {
          const b = this.builder.build(background, page.width, this.styles.defaults, vars)
          if (b) b.draw(under, 0, 0)
        }
      }

      const header = resolve(def.header)
      if (header != null && header !== false) {
        const b = this.builder.build(header, bodyWidth, { ...this.styles.defaults, size: 8.5, color: '#6b7280' }, vars)
        if (b) b.draw(over, page.margins[3], Math.max(8, (page.margins[0] - b.height) / 2))
      }
      const footer = resolve(def.footer ?? (def.pageNumbers ? pageNumberFooter(def.pageNumbers) : null))
      if (footer != null && footer !== false) {
        const b = this.builder.build(footer, bodyWidth, { ...this.styles.defaults, size: 8.5, color: '#6b7280' }, vars)
        if (b) b.draw(over, page.margins[3], page.height - page.margins[2] + Math.max(0, (page.margins[2] - b.height) / 2))
      }

      const watermark = resolve(def.watermark)
      if (watermark) drawWatermark(this, over, page, typeof watermark === 'string' ? { text: watermark } : watermark)

      page.under = under.content()
      page.over = over.content()
    }
  }

  async render() {
    await this.prepare()
    this.layoutPass(null)
    if (hasToc(this.content)) {
      // Second pass with page numbers for the table of contents.
      const entries = this.outlines.map((o) => ({ ...o, pageNumber: o.page.index + 1 }))
      this.layoutPass(entries)
      const pageOf = new Map(this.outlines.map((o) => [o.id, o.page.index + 1]))
      if (entries.some((e) => pageOf.get(e.id) !== e.pageNumber)) {
        this.layoutPass(this.outlines.map((o) => ({ ...o, pageNumber: o.page.index + 1 })))
      }
    }
    return this.write()
  }

  async write() {
    const writer = this.writer
    const def = this.definition
    const pagesRef = writer.alloc()
    const resourcesRef = writer.alloc()

    for (const page of this.pages) {
      const H = page.height
      const content = [`q 1 0 0 -1 0 ${H} cm`, page.under, page.painter.content(), page.over, 'Q'].filter(Boolean).join('\n')
      const contentRef = writer.addStream({}, content)
      const annots = page.annotations.map((a) => this.annotation(a, H)).filter(Boolean)
      writer.set(page.ref, {
        Type: '/Page',
        Parent: pagesRef,
        MediaBox: [0, 0, page.width, H],
        Resources: resourcesRef,
        Contents: contentRef,
        ...(annots.length ? { Annots: annots } : {}),
      })
    }
    writer.set(pagesRef, { Type: '/Pages', Kids: this.pages.map((p) => p.ref), Count: this.pages.length })

    for (const font of this.fonts.allFonts()) font.finalize(writer)
    await Promise.all(this.images.all().map((img) => img.finalize(writer)))
    writer.set(resourcesRef, this.resources.toDict())

    const info = def.info ?? {}
    const now = info.creationDate ?? new Date()
    const infoRef = writer.add({
      Title: info.title ?? def.title,
      Author: info.author ?? def.author,
      Subject: info.subject ?? def.subject,
      Keywords: Array.isArray(info.keywords ?? def.keywords) ? (info.keywords ?? def.keywords).join(', ') : info.keywords ?? def.keywords,
      Creator: info.creator ?? 'Tylix',
      Producer: info.producer ?? 'Tylix PDF',
      CreationDate: now instanceof Date ? pdfDate(now) : now,
      ModDate: now instanceof Date ? pdfDate(now) : now,
    })

    const outlinesRef = this.outlines.length && this.outlineEnabled ? this.writeOutlines() : undefined
    const title = info.title ?? def.title
    const root = writer.add({
      Type: '/Catalog',
      Pages: pagesRef,
      Outlines: outlinesRef,
      PageMode: outlinesRef && def.showOutline !== false ? '/UseOutlines' : undefined,
      ViewerPreferences: title ? { DisplayDocTitle: true } : undefined,
      Lang: def.lang,
    })
    this.pageCount = this.pages.length
    return writer.build({ root, info: infoRef })
  }

  dest(target) {
    const d = this.destinations.get(target)
    if (!d) return null
    return [d.page.ref, '/XYZ', 0, d.page.height - d.y + 4, 0]
  }

  annotation(a, H) {
    const [x1, y1, x2, y2] = a.rect
    const rect = [x1, H - y2, x2, H - y1]
    const base = { Type: '/Annot', Subtype: '/Link', Rect: rect, Border: [0, 0, 0] }
    const target = a.target
    if (typeof target === 'string' && target.startsWith('#')) {
      const dest = this.dest(target.slice(1))
      return dest ? this.writer.add({ ...base, Dest: dest }) : null
    }
    if (target && typeof target === 'object' && target.page) {
      const page = this.pages[target.page - 1]
      return page ? this.writer.add({ ...base, Dest: [page.ref, '/Fit'] }) : null
    }
    return this.writer.add({ ...base, A: { Type: '/Action', S: '/URI', URI: String(target) } })
  }

  writeOutlines() {
    const writer = this.writer
    const rootRef = writer.alloc()
    const root = { ref: rootRef, children: [], level: 0 }
    const stack = [root]
    for (const o of this.outlines) {
      const item = { ref: writer.alloc(), children: [], level: o.level, title: o.title, dest: [o.page.ref, '/XYZ', 0, o.page.height - o.y + 4, 0] }
      while (stack.length > 1 && stack[stack.length - 1].level >= o.level) stack.pop()
      item.parent = stack[stack.length - 1]
      item.parent.children.push(item)
      stack.push(item)
    }
    const count = (node) => node.children.reduce((s, c) => s + 1 + count(c), 0)
    const write = (node) => {
      node.children.forEach((c, i) => {
        const open = c.level < (this.definition.outlineDepth ?? 2)
        writer.set(c.ref, {
          Title: c.title,
          Parent: node.ref,
          Prev: node.children[i - 1]?.ref,
          Next: node.children[i + 1]?.ref,
          First: c.children[0]?.ref,
          Last: c.children[c.children.length - 1]?.ref,
          Count: c.children.length ? (open ? count(c) : -count(c)) : undefined,
          Dest: c.dest,
        })
        write(c)
      })
    }
    write(root)
    writer.set(rootRef, {
      Type: '/Outlines',
      First: root.children[0]?.ref,
      Last: root.children[root.children.length - 1]?.ref,
      Count: count(root),
    })
    return rootRef
  }

  // Outputs

  toBuffer() {
    if (!this.rendered) this.rendered = this.render().then((bytes) => (globalThis.Buffer ? globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes))
    return this.rendered
  }

  async toUint8Array() {
    const b = await this.toBuffer()
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  }

  async toBlob() {
    return new Blob([await this.toUint8Array()], { type: 'application/pdf' })
  }

  async toBase64() {
    const bytes = await this.toUint8Array()
    if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString('base64')
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  async toDataUrl() {
    return 'data:application/pdf;base64,' + (await this.toBase64())
  }

  async save(path) {
    const fs = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, await this.toBuffer())
    return path
  }

  // A web Response (fetch handlers, Hono, Next.js routes, Deno, Bun).
  async toResponse(filename = 'document.pdf', { inline = false } = {}) {
    const bytes = await this.toUint8Array()
    return new Response(bytes, { headers: downloadHeaders(filename, bytes.length, inline) })
  }

  // Node / Express / Tylix response.
  async send(res, filename = 'document.pdf', { inline = false } = {}) {
    const bytes = await this.toBuffer()
    for (const [k, v] of Object.entries(downloadHeaders(filename, bytes.length, inline))) res.setHeader(k, v)
    res.end(bytes)
    return res
  }

  // Browser: save as a file.
  async download(filename = 'document.pdf') {
    const url = URL.createObjectURL(await this.toBlob())
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  // Browser: open in a new tab.
  async open() {
    const url = URL.createObjectURL(await this.toBlob())
    window.open(url, '_blank')
  }
}

export function downloadHeaders(filename, length, inline = false, type = 'application/pdf') {
  const safe = String(filename).replace(/["\\\r\n]/g, '_')
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_')
  return {
    'Content-Type': type,
    'Content-Length': String(length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    'Cache-Control': 'private, no-cache',
  }
}

function pageNumberFooter(opt) {
  const o = typeof opt === 'object' ? opt : {}
  return { text: o.format ?? 'Page {page} of {pages}', align: o.align ?? 'center', size: o.size, color: o.color }
}

function drawWatermark(doc, p, page, w) {
  const size = len(w.size) ?? 72
  const font = doc.fonts.resolve({ font: w.font ?? 'Helvetica', bold: w.bold ?? true })
  const width = (font.measure(w.text) * size) / 1000
  const angle = w.angle ?? -Math.round((Math.atan2(page.height, page.width) * 180) / Math.PI)
  const cx = page.width / 2
  const cy = page.height / 2
  p.save()
  p.opacity(w.opacity ?? 0.12)
  p.rotate(angle, cx, cy)
  p.showText(w.text, cx - width / 2, cy + (size * font.capHeight) / 2000, { font, size, color: w.color ?? '#6b7280' })
  p.restore()
}

// Split top-level content into sections at page breaks that change the
// page setup (size, orientation, margins).
function sections(content) {
  const list = Array.isArray(content) ? content : [content]
  const out = [{ options: {}, nodes: [] }]
  for (const node of list) {
    if (nodeKind(node) === 'pageBreak' && (node.size || node.orientation || node.margins)) {
      out.push({ options: { size: node.size, orientation: node.orientation, margins: node.margins }, nodes: [] })
      continue
    }
    out[out.length - 1].nodes.push(node)
  }
  return out.filter((s, i) => i === 0 || s.nodes.length)
}

function expandHtml(node, doc) {
  if (Array.isArray(node)) return node.map((n) => expandHtml(n, doc))
  if (!node || typeof node !== 'object') return node
  if (typeof node.html === 'string') {
    const { html, ...rest } = node
    return { ...rest, stack: expandHtml(htmlToNodes(html, doc), doc) }
  }
  if (node instanceof Date || isBytes(node)) return node
  const out = {}
  for (const [k, v] of Object.entries(node)) out[k] = typeof v === 'object' && v !== null ? expandHtml(v, doc) : v
  return out
}

function hasToc(node) {
  if (Array.isArray(node)) return node.some(hasToc)
  if (!node || typeof node !== 'object') return false
  if ('toc' in node) return true
  return Object.values(node).some((v) => typeof v === 'object' && v !== null && !isBytes(v) && hasToc(v))
}

export function createPdf(definition) {
  return new PdfDocument(definition)
}

export async function renderPdf(definition) {
  return createPdf(definition).toBuffer()
}

