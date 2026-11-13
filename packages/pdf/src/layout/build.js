// Document nodes -> blocks.

import { breakLines, naturalWidths } from './text.js'
import { len, box, blockOnly } from './style.js'
import { TextBlock, StackBlock, BoxBlock, RowBlock, DrawBlock, PageBreakBlock, AbsoluteBlock, Block, mark } from './blocks.js'
import { buildTable, tableNaturalWidths } from './table.js'
import { renderSvg, parseSvg, svgSize } from '../svg/renderSvg.js'
import { qrMatrix } from '../barcode/qr.js'
import { barcodeModules } from '../barcode/barcode.js'
import { htmlToNodes } from '../html/htmlToNodes.js'

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
// Kinds whose `width` sizes the content itself (not the block's box).
const SIZED_KINDS = new Set(['image', 'svg', 'chart', 'qr', 'barcode', 'canvas'])

function headingLevel(node) {
  const key = HEADINGS.find((h) => h in node)
  return key ? Number(key[1]) : Math.min(6, Math.max(1, node.level ?? 1))
}

// What kind of node this is, from its keys.
export function nodeKind(node) {
  if (node == null || node === false || node === true) return 'empty'
  if (typeof node === 'string' || typeof node === 'number') return 'text'
  if (Array.isArray(node)) return 'stack'
  if (typeof node !== 'object') return 'empty'
  if (node.pageBreak === true || node.pageBreak === 'page' || (node.pageBreak && Object.keys(node).every((k) => ['pageBreak', 'size', 'orientation', 'margins'].includes(k)))) return 'pageBreak'
  for (const h of HEADINGS) if (h in node) return 'heading'
  for (const k of ['heading', 'text', 'stack', 'columns', 'table', 'ul', 'ol', 'list', 'image', 'svg', 'chart', 'qr', 'barcode', 'hr', 'spacer', 'canvas', 'box', 'toc', 'html']) {
    if (k in node) return k === 'ul' || k === 'ol' ? 'list' : k
  }
  return 'empty'
}

export class Builder {
  constructor(doc) {
    this.doc = doc
    this.styles = doc.styles
    this.headingCount = 0
  }

  // Build a node at a width with an inherited text style.
  build(node, width, inherited, vars) {
    const kind = nodeKind(node)
    if (kind === 'empty') return null
    if (kind === 'text' && typeof node !== 'object') node = { text: String(node) }
    if (kind === 'stack' && Array.isArray(node)) node = { stack: node }
    if (kind === 'html') return this.build({ ...node, html: undefined, stack: htmlToNodes(node.html, this.doc) }, width, inherited, vars)
    if (kind === 'heading') {
      // Headings are paragraphs with the hN style first.
      const level = headingLevel(node)
      node = { ...node, style: [`h${level}`].concat(node.style ?? []) }
    }

    const resolved = this.styles.resolve(node, inherited)
    const own = resolved.own
    // A block's background paints its box, not each line of text.
    const style = blockOnly(resolved.text)
    const margins = this.margins(own, kind, vars)
    // Horizontal margins and fixed widths narrow the content.
    const available = width - margins[1] - margins[3]
    let innerWidth = available
    const fixedWidth = len(own.width, width)
    if (fixedWidth && !SIZED_KINDS.has(kind)) innerWidth = Math.min(innerWidth, fixedWidth)
    const decorated = own.padding != null || own.border != null || own.background != null
    const padding = box(own.padding, 0)
    const borderW = this.borderWidths(own.border)
    const contentWidth = decorated ? innerWidth - padding[1] - padding[3] - borderW[1] - borderW[3] : innerWidth

    let block = this.buildKind(kind, node, contentWidth, style, own, vars)
    if (!block) return null
    const outlineEntry = block.outlineEntry
    delete block.outlineEntry

    if (decorated) {
      block = new BoxBlock(block, {
        padding: [padding[0] + borderW[0], padding[1] + borderW[1], padding[2] + borderW[2], padding[3] + borderW[3]],
        background: own.background,
        border: own.border,
        borderColor: own.borderColor,
        radius: own.radius ?? own.borderRadius ?? 0,
        width: innerWidth,
        height: len(own.height),
      })
    }
    if (innerWidth < available - 0.01 || margins[3]) {
      const free = available - innerWidth
      const offset = margins[3] + (own.blockAlign === 'center' ? free / 2 : own.blockAlign === 'right' ? free : 0)
      block = offsetBlock(block, offset)
    }
    block.marginTop = margins[0]
    block.marginBottom = margins[2]
    if (own.keepWithNext ?? (kind === 'heading')) block.keepWithNext = true
    if (own.id) block.id = own.id
    if (own.pageBreak === 'before') block.pageBreakBefore = true
    if (own.pageBreak === 'after') block.pageBreakAfter = true
    if (own.unbreakable || own.keepTogether) unbreakable(block)
    if (outlineEntry) block.outline = outlineEntry
    if (own.absolute) {
      const [ax, ay] = Array.isArray(own.absolute) ? own.absolute : [own.absolute.x, own.absolute.y]
      return new AbsoluteBlock(block, len(ax), len(ay))
    }
    return block
  }

  margins(own, kind, vars) {
    const inList = vars?.__listDepth > 0
    const size = len(own.size) ?? 10.5
    const defaults = {
      text: [0, 0, inList ? size * 0.25 : this.styles.styles.paragraph.marginBottom ?? 8, 0],
      list: inList ? [size * 0.25, 0, size * 0.25, 0] : [0, 0, 8, 0],
      table: [4, 0, 12, 0],
      columns: [0, 0, 8, 0],
      image: [0, 0, 8, 0],
      svg: [0, 0, 8, 0],
      chart: [4, 0, 12, 0],
      qr: [0, 0, 8, 0],
      barcode: [0, 0, 8, 0],
      box: [0, 0, 8, 0],
      toc: [0, 0, 16, 0],
      hr: [8, 0, 8, 0],
    }[kind] ?? [0, 0, 0, 0]
    const base = own.margin != null ? box(own.margin) : defaults
    return [
      len(own.marginTop) ?? base[0],
      len(own.marginRight) ?? base[1],
      len(own.marginBottom) ?? base[2],
      len(own.marginLeft) ?? base[3],
    ]
  }

  borderWidths(border) {
    if (border == null || border === false) return [0, 0, 0, 0]
    if (typeof border === 'number') return [border, border, border, border]
    if (Array.isArray(border)) return border
    const w = border.width ?? 1
    return [border.top ?? w, border.right ?? w, border.bottom ?? w, border.left ?? w]
  }

  buildKind(kind, node, width, style, own, vars) {
    switch (kind) {
      case 'text':
        return this.paragraph(node.text, width, style, vars)
      case 'heading': {
        const level = headingLevel(node)
        const content = node[`h${level}`] ?? node.heading
        const block = this.paragraph(content, width, style, vars)
        const title = plainText(content)
        if (node.outline !== false && this.doc.outlineEnabled) {
          const id = own.id ?? `__h${++this.headingCount}`
          own.id = id
          block.outlineEntry = { title, level, id, toc: node.toc !== false }
        }
        return block
      }
      case 'stack': {
        const children = (node.stack || []).map((child) => this.build(child, width, blockOnly(style), vars))
        const gap = len(node.gap)
        if (gap) children.filter(Boolean).forEach((c, i) => i && (c.marginTop = Math.max(c.marginTop, gap)))
        return new StackBlock(children)
      }
      case 'box': {
        const content = Array.isArray(node.box) ? node.box : [node.box]
        return new StackBlock(content.map((c) => this.build(c, width, blockOnly(style), vars)))
      }
      case 'columns':
        return this.columns(node, width, style, vars)
      case 'table':
        return buildTable(this, node.table, width, style, vars, own)
      case 'list':
        return this.list(node, width, style, vars)
      case 'image':
        return this.image(node, width)
      case 'svg':
        return this.svg(node.svg, node, width, style)
      case 'chart':
        return this.chart(node, width, style)
      case 'qr':
        return this.qr(node, width, style)
      case 'barcode':
        return this.barcode(node, width, style)
      case 'hr': {
        const opts = typeof node.hr === 'object' ? node.hr : {}
        const thickness = len(opts.thickness ?? node.thickness) ?? 0.75
        const color = opts.color ?? node.color ?? '#e5e7eb'
        const b = new DrawBlock(width, thickness, (p, x, y, w) => {
          if (opts.dash) p.dash(opts.dash)
          p.lineWidth(thickness).line(x, y + thickness / 2, x + w, y + thickness / 2).stroke(color)
        })
        return b
      }
      case 'spacer': {
        const b = new Block()
        b.height = len(node.spacer) ?? 12
        return b
      }
      case 'canvas': {
        const w = len(node.width, width) ?? width
        const h = len(node.height) ?? 100
        return new DrawBlock(w, h, (p, x, y, cw, ch) => node.canvas(p, { x, y, width: cw, height: ch }), { align: node.align, available: width })
      }
      case 'toc':
        return this.toc(node, width, style, vars)
      case 'pageBreak': {
        const b = new PageBreakBlock({ size: node.size, orientation: node.orientation, margins: node.margins })
        return b
      }
    }
    return null
  }

  // Text -> runs (resolving fonts and fallbacks).
  runs(content, style, vars) {
    const out = []
    const walk = (spec, inherited) => {
      if (spec == null || spec === false) return
      if (Array.isArray(spec)) {
        for (const s of spec) walk(s, inherited)
        return
      }
      if (typeof spec !== 'object') {
        let text = String(spec)
        if (vars) text = text.replace(/\{(page|pages)\}/g, (_, k) => String(vars[k]))
        if (!text) return
        const resolved = this.doc.fonts.resolveStyle(inherited)
        for (const piece of this.doc.fonts.cover(text, resolved, inherited)) {
          let link = inherited.link
          out.push({
            text: piece.text,
            font: piece.font,
            fauxBold: piece.fauxBold,
            size: len(inherited.size) ?? 10.5,
            color: inherited.color,
            lineHeight: inherited.lineHeight,
            characterSpacing: inherited.characterSpacing,
            underline: inherited.underline,
            strike: inherited.strike,
            decorationColor: inherited.decorationColor,
            background: inherited.background,
            opacity: inherited.opacity,
            baseline: inherited.baseline,
            link,
          })
        }
        return
      }
      // A span: { text, bold, color, link, style… }
      let base = inherited
      if (spec.link) base = { ...base, ...this.styles.styles.link }
      const { text } = this.styles.resolve(spec, base)
      if (spec.sup) text.baseline = 'super'
      if (spec.sub) text.baseline = 'sub'
      if (text.baseline && text.baseline !== 'normal' && spec.size === undefined) text.size = (len(text.size) ?? 10.5) * 0.7
      walk(spec.text ?? spec.sup ?? spec.sub ?? '', text)
    }
    walk(content, style)
    return out
  }

  paragraph(content, width, style, vars) {
    const runs = this.runs(content, style, vars)
    if (!runs.length) {
      // An empty paragraph still takes one line.
      runs.push(...this.runs(' ', style))
    }
    const lines = breakLines(runs, width, { lineHeight: style.lineHeight })
    return new TextBlock(lines, { align: style.align, width })
  }

  // Natural width of a node (for auto table columns).
  natural(node, style) {
    const kind = nodeKind(node)
    if (kind === 'text') {
      const content = typeof node === 'object' ? node.text : String(node)
      const { text } = typeof node === 'object' ? this.styles.resolve(node, style) : { text: style }
      return naturalWidths(this.runs(content, text))
    }
    if (kind === 'heading') return { min: 40, max: 200 }
    if (kind === 'stack') {
      const list = Array.isArray(node) ? node : node.stack
      let min = 0
      let max = 0
      for (const c of list) {
        const n = this.natural(c, style)
        min = Math.max(min, n.min)
        max = Math.max(max, n.max)
      }
      return { min, max }
    }
    if (kind === 'image' || kind === 'svg' || kind === 'qr' || kind === 'barcode' || kind === 'canvas' || kind === 'chart') {
      const w = len(node.width) ?? len(node.size) ?? (kind === 'qr' ? 80 : 120)
      return { min: w, max: w }
    }
    if (kind === 'table') return tableNaturalWidths(this, node.table, style)
    return { min: 30, max: 120 }
  }

  columns(node, width, style, vars) {
    const gap = len(node.gap ?? node.columnGap) ?? 16
    const cols = node.columns.filter((c) => c != null)
    const specs = cols.map((c) => (c && typeof c === 'object' && !Array.isArray(c) ? c.width : undefined))
    const widths = resolveWidths(specs, width - gap * (cols.length - 1), (i) => this.natural(cols[i], style))
    let x = 0
    const cells = cols.map((c, i) => {
      const child = c && typeof c === 'object' && !Array.isArray(c) && c.width !== undefined ? { ...c, width: undefined } : c
      const block = this.build(child, widths[i], blockOnly(style), vars) ?? new StackBlock([])
      const cell = { block: new StackBlock([block]), x, width: widths[i], padding: [0, 0, 0, 0], valign: node.valign ?? (c?.valign) }
      x += widths[i] + gap
      return cell
    })
    return new RowBlock(cells, { gap })
  }

  list(node, width, style, vars) {
    const ordered = 'ol' in node || node.ordered
    const items = node.ol ?? node.ul ?? node.list ?? []
    const depth = (vars?.__listDepth ?? 0)
    const type = node.type ?? (ordered ? 'decimal' : ['disc', 'circle', 'square'][depth % 3])
    const start = node.start ?? 1
    const size = len(style.size) ?? 10.5
    const markerColor = node.markerColor ?? style.color
    const gap = len(node.markerGap) ?? size * 0.6
    const spacing = len(node.spacing) ?? size * 0.25
    const markers = items.map((_, i) => (ordered ? listMarker(type, start + i) : null))
    const markerWidth = ordered
      ? Math.max(...markers.map((m) => this.runs(m, style).reduce((s, r) => s + (r.font.measure(r.text) * r.size) / 1000, 0)), size)
      : size * 0.9
    const childVars = { ...(vars || {}), __listDepth: depth + 1 }
    const contentWidth = width - markerWidth - gap
    const rows = items.map((item, i) => {
      const content = this.build(item, contentWidth, blockOnly(style), childVars) ?? this.paragraph(' ', contentWidth, style)
      content.marginTop = 0
      const lineH = firstLineHeight(content) ?? size * (style.lineHeight ?? 1.4)
      const ascent = firstLineAscent(content) ?? size
      let marker
      if (ordered) {
        marker = this.paragraph(markers[i], markerWidth, { ...style, align: 'right', color: markerColor })
      } else if (type === 'none') marker = new Block()
      else {
        const r = size * 0.18
        marker = new DrawBlock(markerWidth, lineH, (p, x, y) => {
          const cx = x + markerWidth - r * 2.2
          const cy = y + ascent - size * 0.32
          if (type === 'square') p.rect(cx - r, cy - r, r * 2, r * 2).fill(markerColor)
          else if (type === 'circle') p.lineWidth(size * 0.06).circle(cx, cy, r * 0.9).stroke(markerColor)
          else if (type === 'dash') p.rect(cx - r * 1.6, cy - size * 0.03, r * 2.6, size * 0.07).fill(markerColor)
          else if (type === 'check') p.lineWidth(size * 0.09).lineCap('round').lineJoin('round').polygon([[cx - r * 1.4, cy], [cx - r * 0.3, cy + r * 1.1], [cx + r * 1.6, cy - r * 1.4]], false).stroke(markerColor)
          else p.circle(cx, cy, r).fill(markerColor)
        })
      }
      const row = new RowBlock([
        { block: marker, x: 0, width: markerWidth, padding: [0, 0, 0, 0] },
        { block: content, x: markerWidth + gap, width: contentWidth, padding: [0, 0, 0, 0] },
      ])
      row.marginTop = i ? spacing : 0
      return row
    })
    return new StackBlock(rows)
  }

  image(node, width) {
    const img = this.doc.images.get(node.image)
    let w = len(node.width, width)
    let h = len(node.height)
    const ratio = img.height / img.width
    if (node.fit) {
      const [fw, fh] = [len(node.fit[0], width), len(node.fit[1])]
      const scale = Math.min(fw / img.width, fh / img.height)
      w = img.width * scale
      h = img.height * scale
    } else if (w && !h) h = w * ratio
    else if (h && !w) w = h / ratio
    else if (!w && !h) {
      w = img.width * 0.75 // pixels at 96 dpi
      h = img.height * 0.75
    }
    // Never wider than the column, never taller than a page.
    const maxH = this.doc.bodyHeight
    if (w > width) {
      h *= width / w
      w = width
    }
    if (h > maxH) {
      w *= maxH / h
      h = maxH
    }
    const opacity = node.opacity
    return new DrawBlock(w, h, (p, x, y, bw, bh) => {
      if (opacity != null) p.opacity(opacity)
      if (node.radius) p.roundedRect(x, y, bw, bh, len(node.radius)).clip()
      p.image(img, x, y, bw, bh)
      if (node.link) p.link(node.link, x, y, bw, bh)
    }, { align: node.align, available: width })
  }

  svg(source, node, width, style) {
    const tree = typeof source === 'string' ? parseSvg(source) : source
    const size = svgSize(tree)
    let w = len(node.width, width)
    let h = len(node.height)
    const ratio = size.height / size.width
    if (w && !h) h = w * ratio
    else if (h && !w) w = h / ratio
    else if (!w && !h) {
      w = size.width * 0.75
      h = size.height * 0.75
      if (node.chartScale) {
        w = size.width * node.chartScale
        h = size.height * node.chartScale
      }
    }
    if (w > width) {
      h *= width / w
      w = width
    }
    const color = node.color ?? style.color ?? '#000'
    const doc = this.doc
    return new DrawBlock(w, h, (p, x, y, bw, bh) => renderSvg(p, tree, { x, y, width: bw, height: bh, color, fonts: doc.fonts, preserveAspectRatio: node.preserveAspectRatio }), { align: node.align, available: width })
  }

  chart(node, width, style) {
    const charts = this.doc.charts
    if (!charts) throw new Error('Charts need @tylix/charts: npm install @tylix/charts')
    const w = len(node.width, width) ?? width
    const h = len(node.height) ?? Math.round(w * 0.5)
    const type = typeof node.chart === 'string' ? node.chart : node.chart.type
    const data = node.data ?? node.chart.data
    const options = { width: Math.round(w), height: Math.round(h), ...(node.options ?? node.chart.options ?? {}) }
    if (type === 'pie' || type === 'donut' || type === 'gauge') delete options.height
    const svg = charts.renderChart(type, data, options)
    return this.svg(svg, { ...node, width: undefined, height: undefined, chartScale: 1, color: node.color ?? style.color }, width, style)
  }

  qr(node, width, style) {
    const size = len(node.size ?? node.width) ?? 96
    const matrix = qrMatrix(String(node.qr), { level: node.level ?? 'M' })
    const quiet = node.margin ?? 0
    const color = node.color ?? '#000000'
    return new DrawBlock(size, size, (p, x, y, s) => {
      const n = matrix.length + quiet * 2
      const cell = s / n
      if (node.background) p.rect(x, y, s, s).fill(node.background)
      for (let r = 0; r < matrix.length; r++) {
        let c = 0
        while (c < matrix.length) {
          if (!matrix[r][c]) {
            c++
            continue
          }
          let run = 1
          while (c + run < matrix.length && matrix[r][c + run]) run++
          // Slight overlap avoids hairline gaps in some viewers.
          p.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, run * cell + 0.01, cell + 0.01)
          c += run
        }
      }
      p.fill(color)
      if (node.link) p.link(node.link, x, y, s, s)
    }, { align: node.align, available: width })
  }

  barcode(node, width, style) {
    const type = node.type ?? 'code128'
    const { modules, text } = barcodeModules(String(node.barcode), type)
    const w = Math.min(len(node.width, width) ?? modules.length * 1.2, width)
    const barH = len(node.height) ?? 48
    const showText = node.text !== false
    const fontSize = len(node.fontSize) ?? 9
    const textH = showText ? fontSize * 1.4 : 0
    const color = node.color ?? '#000000'
    const doc = this.doc
    return new DrawBlock(w, barH + textH, (p, x, y, bw) => {
      const unit = bw / modules.length
      let i = 0
      while (i < modules.length) {
        if (!modules[i]) {
          i++
          continue
        }
        let run = 1
        while (i + run < modules.length && modules[i + run]) run++
        p.rect(x + i * unit, y, run * unit, barH)
        i += run
      }
      p.fill(color)
      if (showText) {
        const font = doc.fonts.resolve({ font: node.font ?? 'Courier' })
        const tw = (font.measure(text) * fontSize) / 1000
        p.showText(text, x + (bw - tw) / 2, y + barH + fontSize * 1.1, { font, size: fontSize, color })
      }
    }, { align: node.align, available: width })
  }

  toc(node, width, style, vars) {
    const opts = typeof node.toc === 'object' ? node.toc : {}
    const maxLevel = opts.levels ?? 3
    const entries = (this.doc.tocEntries ?? []).filter((e) => e.level <= maxLevel && e.toc)
    const rows = []
    if (opts.title !== false) rows.push(this.build({ h2: opts.title ?? 'Contents', outline: false }, width, style, vars))
    const size = len(style.size) ?? 10.5
    for (const e of entries) {
      const indent = (e.level - 1) * size * 1.5
      const pageText = String(e.pageNumber ?? '00')
      const entryStyle = { ...style, bold: e.level === 1 && opts.boldTopLevel !== false, link: '#' + e.id }
      const numW = 36
      const titleBlock = this.paragraph(e.title, width - indent - numW - 6, entryStyle)
      const numBlock = this.paragraph(pageText, numW, { ...style, align: 'right', link: '#' + e.id })
      const leaderColor = opts.leaderColor ?? '#9ca3af'
      const row = new RowBlock([
        { block: titleBlock, x: indent, width: width - indent - numW - 6, padding: [0, 0, 0, 0] },
        { block: numBlock, x: width - numW, width: numW, padding: [0, 0, 0, 0] },
      ])
      // Dotted leader from the end of the title's last line to the number.
      const last = titleBlock.lines[titleBlock.lines.length - 1]
      const lineTop = titleBlock.height - last.height
      row.drawBorders = (p, x, y) => {
        if (opts.leader === false) return
        const from = x + indent + last.width + 4
        const to = x + width - numW - 2 + (numW - (numBlock.lines[0]?.width ?? 0)) - 4
        if (to <= from) return
        const ly = y + lineTop + last.ascent - 0.5
        p.save().lineWidth(0.8).dash([0.8, 2.6]).lineCap('round').line(from, ly, to, ly).stroke(leaderColor).restore()
      }
      row.marginTop = e.level === 1 ? size * 0.5 : size * 0.15
      rows.push(row)
    }
    return new StackBlock(rows)
  }
}

function offsetBlock(block, dx) {
  const wrapper = Object.create(block)
  const draw = block.draw.bind(block)
  wrapper.draw = (p, x, y) => {
    if (Object.hasOwn(wrapper, 'id') || Object.hasOwn(wrapper, 'outline')) mark(wrapper, p, x, y)
    draw(p, x + dx, y)
  }
  wrapper.split = (avail, opts) => {
    const parts = block.split(avail, opts)
    return parts && parts.map((part) => offsetBlock(part, dx))
  }
  wrapper.minHeight = () => block.minHeight()
  return wrapper
}

function unbreakable(block) {
  const split = block.split.bind(block)
  block.split = (avail, opts) => (opts?.fresh ? split(avail, opts) : null)
}

function firstLineHeight(block) {
  const b = firstText(block)
  return b ? b.lines[0].height : null
}

function firstLineAscent(block) {
  const b = firstText(block)
  return b ? b.lines[0].ascent : null
}

function firstText(block) {
  if (!block) return null
  if (block.lines) return block
  if (block.children) return firstText(block.children[0])
  if (block.inner) return firstText(block.inner)
  if (block.cells) return firstText(block.cells[0]?.block)
  return null
}

// Column widths from specs: number / '30%' fixed, '*' / '2*' flexible,
// 'auto' or undefined sized to content (by natural widths).
export function resolveWidths(specs, total, natural) {
  const widths = new Array(specs.length).fill(0)
  let fixed = 0
  const flex = []
  const auto = []
  specs.forEach((spec, i) => {
    if (spec == null || spec === '*' || /^\d*\.?\d*\*$/.test(String(spec))) {
      const weight = spec == null || spec === '*' ? 1 : parseFloat(spec) || 1
      flex.push({ i, weight })
    } else if (spec === 'auto') auto.push(i)
    else {
      widths[i] = len(spec, total)
      fixed += widths[i]
    }
  })
  let free = total - fixed
  if (auto.length) {
    const nat = auto.map((i) => natural(i))
    const wantMax = nat.reduce((s, n) => s + n.max, 0)
    const wantMin = nat.reduce((s, n) => s + n.min, 0)
    const room = flex.length ? Math.min(free * 0.7, wantMax) : free
    auto.forEach((i, k) => {
      let w
      if (wantMax <= room) w = nat[k].max
      else if (wantMin >= room) w = (nat[k].min / (wantMin || 1)) * room
      else w = nat[k].min + ((nat[k].max - nat[k].min) / (wantMax - wantMin || 1)) * (room - wantMin)
      widths[i] = w
    })
    free -= auto.reduce((s, i) => s + widths[i], 0)
    if (!flex.length && free > 0.01) {
      // Grow auto columns to fill the row.
      const sum = auto.reduce((s, i) => s + widths[i], 0) || 1
      auto.forEach((i) => (widths[i] += (widths[i] / sum) * free))
      free = 0
    }
  }
  const weights = flex.reduce((s, f) => s + f.weight, 0)
  for (const f of flex) widths[f.i] = Math.max(0, (free * f.weight) / weights)
  return widths
}

export function plainText(content) {
  if (content == null) return ''
  if (Array.isArray(content)) return content.map(plainText).join('')
  if (typeof content === 'object') return plainText(content.text)
  return String(content)
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]

export function listMarker(type, n) {
  if (type === 'lower-alpha' || type === 'a') return alpha(n) + '.'
  if (type === 'upper-alpha' || type === 'A') return alpha(n).toUpperCase() + '.'
  if (type === 'lower-roman' || type === 'i') return roman(n) + '.'
  if (type === 'upper-roman' || type === 'I') return roman(n).toUpperCase() + '.'
  return n + '.'
}

function alpha(n) {
  let s = ''
  while (n > 0) {
    n--
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

function roman(n) {
  let s = ''
  for (const [v, r] of ROMAN) while (n >= v) {
    s += r
    n -= v
  }
  return s
}
