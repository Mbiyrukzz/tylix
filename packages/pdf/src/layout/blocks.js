// Laid-out blocks. Each has a height, draws itself at (x, y), and may be
// split at a given height for pagination:
//   split(available, { fresh }) -> [head, tail] | null
// fresh is true when the block starts at the top of an empty page (so
// splitting is the only way forward).

import { drawLines } from './text.js'
import { parseColor } from '../util/color.js'

export class Block {
  constructor() {
    this.height = 0
    this.marginTop = 0
    this.marginBottom = 0
  }
  draw() {}
  split() {
    return null
  }
  // The least height the block needs on a page (first line, first row).
  minHeight() {
    return this.height
  }
  copyMeta(from) {
    this.marginTop = from.marginTop
    this.marginBottom = from.marginBottom
    this.keepWithNext = from.keepWithNext
    this.id = from.id
    this.outline = from.outline
    return this
  }
}

// Whether a forced page break sits inside (not at the very end).
export function containsBreak(block) {
  const kids = block.children
  if (!kids) return false
  return kids.some((c, i) => (c.pageBreakAfter && i < kids.length - 1) || (c.pageBreakBefore && i > 0) || containsBreak(c))
}

// Marks a destination (id / outline / toc entry) where it's drawn.
export function mark(block, painter, x, y) {
  if (block.id) painter.doc.addDestination(block.id, painter.page, y)
  if (block.outline) painter.doc.addOutline({ ...block.outline, page: painter.page, y })
}

export class TextBlock extends Block {
  constructor(lines, { align = 'left', width, orphans = 2, widows = 2 } = {}) {
    super()
    this.lines = lines
    this.align = align
    this.width = width
    this.orphans = orphans
    this.widows = widows
    this.height = lines.reduce((s, l) => s + l.height, 0)
  }

  minHeight() {
    const n = Math.min(this.lines.length, this.lines.length >= this.orphans + this.widows ? this.orphans : this.lines.length)
    return this.lines.slice(0, n).reduce((s, l) => s + l.height, 0)
  }

  draw(painter, x, y) {
    mark(this, painter, x, y)
    drawLines(painter, this.lines, x, y, this.width, { align: this.align })
  }

  split(available, { fresh } = {}) {
    let used = 0
    let count = 0
    for (const line of this.lines) {
      if (used + line.height > available + 0.01) break
      used += line.height
      count++
    }
    if (count >= this.lines.length) return null
    // Widows and orphans: keep at least N lines on each side.
    if (!fresh) {
      const total = this.lines.length
      if (count < this.orphans && total >= this.orphans) return null
      if (total - count < this.widows) count = Math.max(0, total - this.widows)
      if (count < this.orphans && total > 1) return null
    }
    if (count === 0) {
      if (!fresh) return null
      count = 1 // a line taller than the page: put it anyway
    }
    const head = new TextBlock(this.lines.slice(0, count), this).copyMeta(this)
    head.marginBottom = 0
    head.keepWithNext = false
    const tail = new TextBlock(this.lines.slice(count), this).copyMeta(this)
    tail.marginTop = 0
    tail.id = tail.outline = undefined
    return [head, tail]
  }
}

export class StackBlock extends Block {
  constructor(children = []) {
    super()
    this.children = children.filter(Boolean)
    if (this.children[0]?.pageBreakBefore) this.pageBreakBefore = true
    this.measure()
  }

  measure() {
    let h = 0
    let prevMargin = null
    for (const c of this.children) {
      if (c.absolute) continue
      h += prevMargin === null ? 0 : Math.max(prevMargin, c.marginTop)
      h += c.height
      prevMargin = c.marginBottom
    }
    this.height = h
    // A stack's own margins come from its first/last child.
    if (this.children.length) {
      this.innerTop = this.children[0].marginTop
      this.innerBottom = this.children[this.children.length - 1].marginBottom
    }
  }

  minHeight() {
    const first = this.children.find((c) => !c.absolute)
    if (!first) return 0
    let h = first.minHeight()
    // A heading that keeps with the next block needs some of it too.
    if (first.keepWithNext) {
      const i = this.children.indexOf(first)
      const next = this.children.slice(i + 1).find((c) => !c.absolute)
      if (next) h = first.height + Math.max(first.marginBottom, next.marginTop) + next.minHeight()
    }
    return h
  }

  draw(painter, x, y) {
    mark(this, painter, x, y)
    let top = y
    let prevMargin = null
    for (const c of this.children) {
      if (c.absolute) {
        c.draw(painter, x, y)
        continue
      }
      top += prevMargin === null ? 0 : Math.max(prevMargin, c.marginTop)
      c.draw(painter, x, top)
      top += c.height
      prevMargin = c.marginBottom
    }
  }

  split(available, opts = {}) {
    let used = 0
    let prevMargin = null
    const kids = this.children
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]
      if (c.absolute) continue
      const gap = prevMargin === null ? 0 : Math.max(prevMargin, c.marginTop)
      if (c.pageBreakBefore && i > 0 && used > 0) return this.cut(i, null, null)
      if (used + gap + c.height <= available + 0.01) {
        // Fits, but holds a forced page break: split there.
        if (c.children && containsBreak(c)) {
          const parts = c.split(available - used - gap, opts)
          if (parts) return this.cut(i, parts[0], parts[1])
        }
        // Fits; but a keep-with-next block needs the start of what follows.
        if (c.keepWithNext) {
          const next = kids.slice(i + 1).find((k) => !k.absolute)
          if (next) {
            const after = used + gap + c.height + Math.max(c.marginBottom, next.marginTop) + next.minHeight()
            // Move it to the next page with what follows (unless it's
            // already first on an empty page; then there's no better spot).
            if (after > available + 0.01 && (used > 0 || !opts.fresh)) return this.cut(i, null, null)
          }
        }
        used += gap + c.height
        prevMargin = c.marginBottom
        if (c.pageBreakAfter && i < kids.length - 1) return this.cut(i + 1, null, null)
        continue
      }
      // Doesn't fit: try splitting it.
      const room = available - used - gap
      const parts = room > 0 ? c.split(room, { fresh: opts.fresh && used === 0 }) : null
      if (parts && parts[0].height > 0) return this.cut(i, parts[0], parts[1])
      if (used === 0) {
        // Too tall for an empty page and can't split: place it anyway.
        return opts.fresh ? this.cut(i + 1, null, null) : null
      }
      return this.cut(i, null, null)
    }
    return null
  }

  // Head = children before i (+ headPart); tail = tailPart + the rest.
  cut(i, headPart, tailPart) {
    const before = this.children.slice(0, i)
    const after = this.children.slice(i + (headPart ? 1 : 0))
    if (headPart) before.push(headPart)
    if (tailPart) after.unshift(tailPart)
    if (!before.some((c) => !c.absolute)) return null
    const head = new StackBlock(before).copyMeta(this)
    head.marginBottom = 0
    head.keepWithNext = false
    const tail = new StackBlock(after).copyMeta(this)
    tail.marginTop = 0
    tail.id = tail.outline = undefined
    if (after[0]) after[0] = withoutTopMargin(after[0], tail)
    return [head, tail]
  }
}

function withoutTopMargin(block, stack) {
  // Content continuing on a new page starts flush with the top.
  if (block.marginTop) {
    const clone = Object.assign(Object.create(Object.getPrototypeOf(block)), block)
    clone.marginTop = 0
    stack.children[0] = clone
    stack.measure()
    return clone
  }
  return block
}

// Decorated container: padding, background, border, rounded corners.
export class BoxBlock extends Block {
  constructor(inner, { padding = [0, 0, 0, 0], background, border, borderColor = '#e5e7eb', radius = 0, width, height, openTop = false, openBottom = false } = {}) {
    super()
    this.inner = inner
    this.opts = { padding, background, border, borderColor, radius, width, height, openTop, openBottom }
    this.padding = padding
    this.width = width
    this.fixedHeight = height
    this.height = height ?? inner.height + padding[0] + padding[2]
  }

  minHeight() {
    return Math.min(this.height, this.inner.minHeight() + this.padding[0] + this.padding[2])
  }

  draw(painter, x, y) {
    mark(this, painter, x, y)
    const { background, border, borderColor, radius, openTop, openBottom } = this.opts
    const w = this.width
    const h = this.height
    const r = openTop || openBottom ? [openTop ? 0 : radius, openTop ? 0 : radius, openBottom ? 0 : radius, openBottom ? 0 : radius] : radius
    if (background) {
      painter.save()
      painter.roundedRect(x, y, w, h, r).fill(background)
      painter.restore()
    }
    painter.save()
    if (this.opts.clip) painter.rect(x, y, w, h).clip()
    this.inner.draw(painter, x + this.padding[3], y + this.padding[0])
    painter.restore()
    if (border) drawBorder(painter, x, y, w, h, border, borderColor, r, { openTop, openBottom })
  }

  split(available, opts) {
    const pad = this.padding[0] + this.padding[2]
    if (this.fixedHeight) return null
    const parts = this.inner.split(available - pad, opts)
    if (!parts) return null
    const head = new BoxBlock(parts[0], { ...this.opts, openBottom: true }).copyMeta(this)
    head.marginBottom = 0
    const tail = new BoxBlock(parts[1], { ...this.opts, openTop: true }).copyMeta(this)
    tail.marginTop = 0
    tail.id = tail.outline = undefined
    return [head, tail]
  }
}

// border: number (all sides), [t, r, b, l] widths, or { width, color,
// dash, top, right, bottom, left }.
export function drawBorder(painter, x, y, w, h, border, color = '#e5e7eb', radius = 0, { openTop, openBottom } = {}) {
  let widths
  let dash
  if (typeof border === 'object' && !Array.isArray(border)) {
    const base = border.width ?? 1
    widths = [border.top ?? base, border.right ?? base, border.bottom ?? base, border.left ?? base]
    color = border.color ?? color
    dash = border.dash
  } else widths = Array.isArray(border) ? border : [border, border, border, border]
  if (openTop) widths[0] = 0
  if (openBottom) widths[2] = 0
  const uniform = widths.every((v) => v === widths[0]) && widths[0] > 0
  painter.save()
  if (dash) painter.dash(dash)
  const rounded = Array.isArray(radius) ? radius.some(Boolean) : radius > 0
  if (uniform) {
    const t = widths[0]
    painter.lineWidth(t)
    if (rounded) painter.roundedRect(x + t / 2, y + t / 2, w - t, h - t, radius).stroke(color)
    else painter.rect(x + t / 2, y + t / 2, w - t, h - t).stroke(color)
  } else {
    const [t, r, b, l] = widths
    if (t) painter.lineWidth(t).line(x, y + t / 2, x + w, y + t / 2).stroke(color)
    if (b) painter.lineWidth(b).line(x, y + h - b / 2, x + w, y + h - b / 2).stroke(color)
    if (l) painter.lineWidth(l).line(x + l / 2, y, x + l / 2, y + h).stroke(color)
    if (r) painter.lineWidth(r).line(x + w - r / 2, y, x + w - r / 2, y + h).stroke(color)
  }
  painter.restore()
}

// Side-by-side cells (columns, table rows). cells: [{ block, x, width,
// padding, background, border, align, valign }].
export class RowBlock extends Block {
  constructor(cells, { minHeight = 0, gap = 0 } = {}) {
    super()
    this.cells = cells
    this.min = minHeight
    this.gap = gap
    this.height = Math.max(minHeight, ...cells.map((c) => c.block.height + c.padding[0] + c.padding[2]))
  }

  minHeight() {
    return Math.max(...this.cells.map((c) => Math.min(c.block.height, c.block.minHeight()) + c.padding[0] + c.padding[2]))
  }

  draw(painter, x, y) {
    mark(this, painter, x, y)
    const h = this.height
    for (const c of this.cells) {
      if (c.background) {
        painter.save()
        painter.rect(x + c.x, y, c.width, h).fill(c.background)
        painter.restore()
      }
    }
    for (const c of this.cells) {
      const inner = c.block.height
      const free = h - c.padding[0] - c.padding[2] - inner
      const dy = c.valign === 'middle' ? free / 2 : c.valign === 'bottom' ? free : 0
      c.block.draw(painter, x + c.x + c.padding[3], y + c.padding[0] + dy)
    }
    if (this.drawBorders) this.drawBorders(painter, x, y, h)
  }

  split(available, opts) {
    if (this.unbreakable && !opts.fresh) return null
    const heads = []
    const tails = []
    let any = false
    for (const c of this.cells) {
      const room = available - c.padding[0] - c.padding[2]
      if (c.block.height <= room + 0.01) {
        heads.push(c.block)
        tails.push(new StackBlock([]))
        continue
      }
      const parts = room > 0 ? c.block.split(room, opts) : null
      if (!parts) return null
      heads.push(parts[0])
      tails.push(parts[1])
      any = true
    }
    if (!any) return null
    const make = (blocks, part) => {
      const row = new RowBlock(this.cells.map((c, i) => ({ ...c, block: blocks[i] })), { gap: this.gap })
      row.drawBorders = this.drawBorders
      row.unbreakable = this.unbreakable
      row.copyMeta(this)
      if (part === 'head') {
        row.marginBottom = 0
        row.height = Math.max(row.height, Math.min(available, this.height))
      } else {
        row.marginTop = 0
        row.id = row.outline = undefined
      }
      return row
    }
    return [make(heads, 'head'), make(tails, 'tail')]
  }
}

// Atomic content drawn by a callback (images, svg, qr, canvas).
export class DrawBlock extends Block {
  constructor(width, height, drawFn, { align = 'left', available } = {}) {
    super()
    this.width = width
    this.height = height
    this.drawFn = drawFn
    this.align = align
    this.available = available ?? width
  }

  draw(painter, x, y) {
    mark(this, painter, x, y)
    const free = this.available - this.width
    const dx = this.align === 'center' ? free / 2 : this.align === 'right' ? free : 0
    painter.save()
    this.drawFn(painter, x + dx, y, this.width, this.height)
    painter.restore()
  }
}

export class PageBreakBlock extends Block {
  constructor(options = {}) {
    super()
    this.pageBreakAfter = true
    this.pageOptions = options
  }
}

// Drawn at a fixed spot on the page, outside the flow.
export class AbsoluteBlock extends Block {
  constructor(block, x, y) {
    super()
    this.absolute = true
    this.block = block
    this.ax = x
    this.ay = y
  }

  draw(painter) {
    this.block.draw(painter, this.ax, this.ay)
  }
}

export function colorOrNull(c) {
  try {
    return c && parseColor(c) ? c : null
  } catch {
    return null
  }
}
