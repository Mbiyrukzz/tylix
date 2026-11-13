// Draws onto one page (or form). Coordinates are in points with the
// origin at the top-left and y growing down, like CSS and <canvas>; the
// page flips once at the start so nothing else has to.

import { num } from '../writer/objects.js'
import { parseColor } from '../util/color.js'
import { parsePath } from './svgPath.js'

const KAPPA = 0.5522847498

export class Painter {
  constructor(doc, page) {
    this.doc = doc
    this.page = page // { width, height, annotations }
    this.resources = doc.resources
    this.ops = []
    this.stack = []
    this.state = { fillOpacity: 1, strokeOpacity: 1 }
    this.pathBox = null // bbox of the current path (for gradients)
  }

  op(text) {
    this.ops.push(text)
    return this
  }

  content() {
    return this.ops.join('\n')
  }

  // State

  save() {
    this.stack.push({ ...this.state })
    return this.op('q')
  }

  restore() {
    if (this.stack.length) this.state = this.stack.pop()
    return this.op('Q')
  }

  transform(a, b, c, d, e, f) {
    return this.op(`${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} cm`)
  }

  translate(x, y) {
    return this.transform(1, 0, 0, 1, x, y)
  }

  scale(sx, sy = sx, origin) {
    if (origin) this.translate(origin[0], origin[1])
    this.transform(sx, 0, 0, sy, 0, 0)
    if (origin) this.translate(-origin[0], -origin[1])
    return this
  }

  // Degrees, clockwise on the page (y is down), around (cx, cy).
  rotate(degrees, cx = 0, cy = 0) {
    const r = (degrees * Math.PI) / 180
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    return this.transform(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy)
  }

  lineWidth(w) {
    return this.op(`${num(w)} w`)
  }

  lineCap(cap) {
    return this.op(`${{ butt: 0, round: 1, square: 2 }[cap] ?? 0} J`)
  }

  lineJoin(join) {
    return this.op(`${{ miter: 0, round: 1, bevel: 2 }[join] ?? 0} j`)
  }

  miterLimit(m) {
    return this.op(`${num(m)} M`)
  }

  dash(pattern, phase = 0) {
    if (!pattern || !pattern.length) return this.op('[] 0 d')
    const list = typeof pattern === 'number' ? [pattern, pattern] : pattern
    return this.op(`[${list.map(num).join(' ')}] ${num(phase)} d`)
  }

  opacity(fill = 1, stroke = fill) {
    this.state.fillOpacity = fill
    this.state.strokeOpacity = stroke
    return this.op(`/${this.resources.opacity(fill, stroke)} gs`)
  }

  fillColor(color) {
    const c = typeof color === 'object' && color?.space ? color : parseColor(color)
    if (!c) return this
    if (c.alpha < 1) this.op(`/${this.resources.opacity(c.alpha * this.state.fillOpacity, this.state.strokeOpacity)} gs`)
    return this.op(c.space === 'cmyk' ? `${c.values.map(num).join(' ')} k` : `${c.values.map(num).join(' ')} rg`)
  }

  strokeColor(color) {
    const c = typeof color === 'object' && color?.space ? color : parseColor(color)
    if (!c) return this
    if (c.alpha < 1) this.op(`/${this.resources.opacity(this.state.fillOpacity, c.alpha * this.state.strokeOpacity)} gs`)
    return this.op(c.space === 'cmyk' ? `${c.values.map(num).join(' ')} K` : `${c.values.map(num).join(' ')} RG`)
  }

  // Paths

  track(x, y) {
    const b = this.pathBox
    if (!b) this.pathBox = [x, y, x, y]
    else {
      if (x < b[0]) b[0] = x
      if (y < b[1]) b[1] = y
      if (x > b[2]) b[2] = x
      if (y > b[3]) b[3] = y
    }
  }

  moveTo(x, y) {
    this.track(x, y)
    return this.op(`${num(x)} ${num(y)} m`)
  }

  lineTo(x, y) {
    this.track(x, y)
    return this.op(`${num(x)} ${num(y)} l`)
  }

  bezierCurveTo(x1, y1, x2, y2, x, y) {
    this.track(x1, y1)
    this.track(x2, y2)
    this.track(x, y)
    return this.op(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)} c`)
  }

  quadraticCurveTo(cx, cy, x, y, from = this.lastPoint) {
    const [x0, y0] = from ?? [x, y]
    return this.bezierCurveTo(x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y)
  }

  closePath() {
    return this.op('h')
  }

  rect(x, y, w, h) {
    this.track(x, y)
    this.track(x + w, y + h)
    return this.op(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`)
  }

  // radius: a number or [topLeft, topRight, bottomRight, bottomLeft].
  roundedRect(x, y, w, h, radius = 0) {
    let [tl, tr, br, bl] = Array.isArray(radius) ? radius : [radius, radius, radius, radius]
    const max = Math.min(w, h) / 2
    ;[tl, tr, br, bl] = [tl, tr, br, bl].map((r) => Math.max(0, Math.min(r || 0, max)))
    if (!tl && !tr && !br && !bl) return this.rect(x, y, w, h)
    const k = 1 - KAPPA
    this.moveTo(x + tl, y)
    this.lineTo(x + w - tr, y)
    if (tr) this.bezierCurveTo(x + w - tr * k, y, x + w, y + tr * k, x + w, y + tr)
    this.lineTo(x + w, y + h - br)
    if (br) this.bezierCurveTo(x + w, y + h - br * k, x + w - br * k, y + h, x + w - br, y + h)
    this.lineTo(x + bl, y + h)
    if (bl) this.bezierCurveTo(x + bl * k, y + h, x, y + h - bl * k, x, y + h - bl)
    this.lineTo(x, y + tl)
    if (tl) this.bezierCurveTo(x, y + tl * k, x + tl * k, y, x + tl, y)
    return this.closePath()
  }

  ellipse(cx, cy, rx, ry = rx) {
    const ox = rx * KAPPA
    const oy = ry * KAPPA
    this.moveTo(cx + rx, cy)
    this.bezierCurveTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry)
    this.bezierCurveTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy)
    this.bezierCurveTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry)
    this.bezierCurveTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy)
    return this.closePath()
  }

  circle(cx, cy, r) {
    return this.ellipse(cx, cy, r, r)
  }

  polygon(points, close = true) {
    points.forEach(([x, y], i) => (i ? this.lineTo(x, y) : this.moveTo(x, y)))
    return close ? this.closePath() : this
  }

  line(x1, y1, x2, y2) {
    return this.moveTo(x1, y1).lineTo(x2, y2)
  }

  // SVG path data.
  path(d) {
    for (const seg of parsePath(d)) {
      if (seg[0] === 'M') this.moveTo(seg[1], seg[2])
      else if (seg[0] === 'L') this.lineTo(seg[1], seg[2])
      else if (seg[0] === 'C') this.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6])
      else this.closePath()
    }
    return this
  }

  // Painting. fill/stroke take an optional color (or gradient object).

  fill(color, { rule = 'nonzero' } = {}) {
    if (color && typeof color === 'object' && color.stops) return this.fillGradient(color, rule)
    if (color !== undefined) this.fillColor(color)
    this.pathBox = null
    return this.op(rule === 'evenodd' ? 'f*' : 'f')
  }

  stroke(color) {
    if (color !== undefined) this.strokeColor(color)
    this.pathBox = null
    return this.op('S')
  }

  fillAndStroke(fill, stroke, { rule = 'nonzero' } = {}) {
    if (fill !== undefined) this.fillColor(fill)
    if (stroke !== undefined) this.strokeColor(stroke)
    this.pathBox = null
    return this.op(rule === 'evenodd' ? 'B*' : 'B')
  }

  clip(rule = 'nonzero') {
    this.pathBox = null
    return this.op(rule === 'evenodd' ? 'W* n' : 'W n')
  }

  endPath() {
    this.pathBox = null
    return this.op('n')
  }

  // gradient: { type: 'linear', x1, y1, x2, y2, stops: [{ offset, color,
  // opacity }] } or { type: 'radial', cx, cy, r, fx?, fy?, stops }.
  // units: 'box' maps 0..1 coordinates onto the current path's bounds.
  fillGradient(gradient, rule = 'nonzero') {
    const box = this.pathBox ?? [0, 0, this.page.width, this.page.height]
    const g = resolveGradient(gradient, box)
    const name = this.resources.shading(g)
    const varying = g.stops.some((s) => (s.opacity ?? 1) * (parseColor(s.color)?.alpha ?? 1) < 1)
    this.op('q')
    this.op(rule === 'evenodd' ? 'W* n' : 'W n')
    if (varying) {
      // Opacity that changes along the gradient needs a soft mask: a gray
      // version of the same shading, drawn in the current space.
      const alpha = this.resources.alphaShading(g)
      const pad = 1
      const form = this.doc.writer.addStream(
        {
          Type: '/XObject',
          Subtype: '/Form',
          BBox: [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad],
          Group: { S: '/Transparency', CS: '/DeviceGray' },
          Resources: { Shading: { A: alpha } },
        },
        '/A sh',
      )
      this.op(`/${this.resources.softMask(form)} gs`)
    } else if (this.state.fillOpacity < 1) {
      this.op(`/${this.resources.opacity(this.state.fillOpacity, this.state.strokeOpacity)} gs`)
    }
    this.op(`/${name} sh`)
    this.pathBox = null
    return this.op('Q')
  }

  // Images: draw a loaded image at x, y with size w × h.
  image(img, x, y, w, h) {
    const name = this.resources.xobject(img.embed(this.doc.writer))
    // Unit square -> box, flipped back because images are bottom-up.
    const [a, b, c, d, e, f] = img.matrix(x, -(y + h), w, h)
    this.op('q')
    this.op('1 0 0 -1 0 0 cm')
    this.transform(a, b, c, d, e, f)
    this.op(`/${name} Do`)
    return this.op('Q')
  }

  // Text: one line at the baseline (x, y). For wrapped text use the
  // layout nodes, or doc.text() in canvas callbacks.
  showText(text, x, y, { font, size = 12, color, wordSpacing = 0, characterSpacing = 0, render } = {}) {
    if (!font) font = this.doc.fonts.resolve({})
    const name = this.resources.font(font)
    this.op('BT')
    if (color !== undefined) this.fillColor(color)
    if (render) this.op(`${render} Tr`)
    if (characterSpacing) this.op(`${num(characterSpacing)} Tc`)
    this.op(`/${name} ${num(size)} Tf`)
    this.op(`1 0 0 -1 ${num(x)} ${num(y)} Tm`)
    this.op(font.show(text, (wordSpacing * 1000) / size))
    return this.op('ET')
  }

  // Wrapped rich text (same content and props as a { text } node) with
  // its top-left at (x, y). Returns the height used.
  text(content, x, y, options = {}) {
    const block = this.doc.layoutText(content, options)
    block.draw(this, x, y)
    return block.height
  }

  // Width of a single line of text in points.
  textWidth(content, options = {}) {
    const block = this.doc.layoutText(content, { ...options, width: Infinity })
    return Math.max(0, ...block.lines.map((l) => l.width))
  }

  // Link annotations. target: a URL, or { page: n } / { dest: 'name' }.
  link(target, x, y, w, h) {
    this.page.annotations.push({ target, rect: [x, y, x + w, y + h] })
    return this
  }
}

function resolveGradient(g, box) {
  const [x0, y0, x1, y1] = box
  const w = x1 - x0
  const h = y1 - y0
  const units = g.units ?? 'box'
  const px = (v) => (units === 'box' ? x0 + v * w : v)
  const py = (v) => (units === 'box' ? y0 + v * h : v)
  if (g.type === 'radial') {
    const r = units === 'box' ? (g.r ?? 0.5) * Math.max(w, h) : g.r
    return { type: 'radial', cx: px(g.cx ?? 0.5), cy: py(g.cy ?? 0.5), fx: px(g.fx ?? g.cx ?? 0.5), fy: py(g.fy ?? g.cy ?? 0.5), r, stops: g.stops }
  }
  return { type: 'linear', x1: px(g.x1 ?? 0), y1: py(g.y1 ?? 0), x2: px(g.x2 ?? 1), y2: py(g.y2 ?? 0), stops: g.stops }
}
