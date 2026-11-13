// SVG -> PDF vector graphics: paths, shapes, text, groups, transforms,
// linear / radial gradients, opacity, dashes, simple <style> rules and
// embedded (data: URL) images. Enough for icons, logos and every chart
// @tylix/charts draws.

import { parseMarkup, parseStyle, parseCss, matchCss, textContent } from '../util/markup.js'
import { parseColor } from '../util/color.js'
import { openImage } from '../images/PdfImage.js'
import { decodeDataUrl } from '../util/bytes.js'

export function parseSvg(source) {
  const root = parseMarkup(String(source))
  const svg = findFirst(root, 'svg')
  if (!svg) throw new Error('No <svg> element found')
  return svg
}

function findFirst(node, tag) {
  if (typeof node === 'string') return null
  if (node.tag === tag) return node
  for (const c of node.children) {
    const f = findFirst(c, tag)
    if (f) return f
  }
  return null
}

const num = (v, fallback = 0) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

export function svgSize(svg) {
  const vb = (svg.attrs.viewBox || svg.attrs.viewbox || '').split(/[\s,]+/).map(Number)
  const w = parseFloat(svg.attrs.width)
  const h = parseFloat(svg.attrs.height)
  const hasPercent = /%/.test(svg.attrs.width ?? '') || /%/.test(svg.attrs.height ?? '')
  if (w && h && !hasPercent) return { width: w, height: h }
  if (vb.length === 4 && vb[2] && vb[3]) {
    if (w && !hasPercent) return { width: w, height: (w * vb[3]) / vb[2] }
    return { width: vb[2], height: vb[3] }
  }
  return { width: w || 300, height: h || 150 }
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'color', 'visibility', 'stroke-miterlimit', 'letter-spacing']

export function renderSvg(painter, svg, { x, y, width, height, color = '#000', fonts, preserveAspectRatio }) {
  const size = svgSize(svg)
  const vb = (svg.attrs.viewBox || svg.attrs.viewbox || '').split(/[\s,]+/).map(Number)
  const [vx, vy, vw, vh] = vb.length === 4 && vb[2] && vb[3] ? vb : [0, 0, size.width, size.height]
  const par = preserveAspectRatio ?? svg.attrs.preserveAspectRatio ?? 'xMidYMid meet'
  let sx = width / vw
  let sy = height / vh
  let tx = x
  let ty = y
  if (par !== 'none') {
    const s = /slice/.test(par) ? Math.max(sx, sy) : Math.min(sx, sy)
    const alignX = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5
    const alignY = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5
    tx += (width - vw * s) * alignX
    ty += (height - vh * s) * alignY
    sx = sy = s
  }

  const ctx = {
    painter,
    fonts,
    defs: new Map(),
    css: [],
    ancestors: [],
  }
  collect(svg, ctx)

  painter.save()
  if (svg.attrs.overflow !== 'visible') painter.rect(x, y, width, height).clip()
  painter.transform(sx, 0, 0, sy, tx - vx * sx, ty - vy * sy)
  const style = { fill: '#000', stroke: 'none', 'stroke-width': '1', color, 'font-size': '16', 'font-family': 'Helvetica' }
  for (const child of svg.children) drawNode(child, inherit(style, svg, ctx), ctx)
  painter.restore()
}

// Gather <defs> (gradients by id) and <style> rules.
function collect(node, ctx) {
  if (typeof node === 'string') return
  if (node.tag === 'style') ctx.css.push(...parseCss(textContent(node)))
  if ((node.tag === 'linearGradient' || node.tag === 'radialGradient') && node.attrs.id) ctx.defs.set(node.attrs.id, node)
  if (node.attrs?.id && !ctx.defs.has(node.attrs.id)) ctx.defs.set(node.attrs.id, node)
  for (const c of node.children) collect(c, ctx)
}

function inherit(parent, el, ctx) {
  const own = { ...matchCss(ctx.css, el, ctx.ancestors), ...attrsStyle(el) }
  const out = {}
  for (const k of INHERITED) out[k] = parent[k]
  for (const [k, v] of Object.entries(own)) out[k] = v
  if (out.color === 'currentColor' || out.color === 'inherit') out.color = parent.color
  return out
}

function attrsStyle(el) {
  const out = {}
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k === 'style' || k === 'class' || k === 'id' || k === 'd' || k === 'transform') continue
    out[k] = v
  }
  return Object.assign(out, parseStyle(el.attrs.style))
}

const SKIP = new Set(['defs', 'title', 'desc', 'style', 'metadata', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'pattern', 'symbol', 'marker', 'filter', 'script'])

function drawNode(node, parentStyle, ctx) {
  if (typeof node === 'string' || SKIP.has(node.tag)) return
  const style = inherit(parentStyle, node, ctx)
  if (style.display === 'none' || style.visibility === 'hidden') return
  const p = ctx.painter
  const opacity = num(style.opacity, 1)
  if (opacity <= 0) return
  p.save()
  if (node.attrs.transform) applyTransform(p, node.attrs.transform)
  const groupOpacity = opacity
  const tag = node.tag
  ctx.ancestors.push(node)
  if (tag === 'g' || tag === 'svg' || tag === 'a') {
    if (tag === 'svg' && node !== null) {
      const xx = num(node.attrs.x)
      const yy = num(node.attrs.y)
      if (xx || yy) p.translate(xx, yy)
    }
    const childStyle = { ...style, opacity: undefined, __opacity: (parentStyle.__opacity ?? 1) * groupOpacity }
    for (const c of node.children) drawNode(c, childStyle, ctx)
  } else if (tag === 'use') {
    const ref = (node.attrs.href || node.attrs['xlink:href'] || '').replace(/^#/, '')
    const target = ctx.defs.get(ref)
    if (target) {
      p.translate(num(node.attrs.x), num(node.attrs.y))
      drawNode(target, { ...style, __opacity: (parentStyle.__opacity ?? 1) * groupOpacity }, ctx)
    }
  } else if (tag === 'text') {
    drawText(node, style, ctx, (parentStyle.__opacity ?? 1) * groupOpacity)
  } else if (tag === 'image') {
    drawImage(node, ctx)
  } else {
    const start = p.ops.length
    if (shape(node, p)) paint(style, ctx, (parentStyle.__opacity ?? 1) * groupOpacity, tag === 'line' || tag === 'polyline', p.ops.slice(start))
  }
  ctx.ancestors.pop()
  p.restore()
}

function shape(node, p) {
  const a = node.attrs
  switch (node.tag) {
    case 'path':
      if (!a.d) return false
      p.path(a.d)
      return true
    case 'rect': {
      const w = num(a.width)
      const h = num(a.height)
      if (w <= 0 || h <= 0) return false
      let rx = a.rx != null ? num(a.rx) : a.ry != null ? num(a.ry) : 0
      if (rx) p.roundedRect(num(a.x), num(a.y), w, h, rx)
      else p.rect(num(a.x), num(a.y), w, h)
      return true
    }
    case 'circle': {
      const r = num(a.r)
      if (r <= 0) return false
      p.circle(num(a.cx), num(a.cy), r)
      return true
    }
    case 'ellipse': {
      const rx = num(a.rx)
      const ry = num(a.ry)
      if (rx <= 0 || ry <= 0) return false
      p.ellipse(num(a.cx), num(a.cy), rx, ry)
      return true
    }
    case 'line':
      p.line(num(a.x1), num(a.y1), num(a.x2), num(a.y2))
      return true
    case 'polyline':
    case 'polygon': {
      const pts = (a.points || '').trim().split(/[\s,]+/).map(Number)
      const list = []
      for (let i = 0; i + 1 < pts.length; i += 2) list.push([pts[i], pts[i + 1]])
      if (list.length < 2) return false
      p.polygon(list, node.tag === 'polygon')
      return true
    }
  }
  return false
}

function paintFor(value, style, ctx) {
  if (!value || value === 'none' || value === 'transparent') return null
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value)
  if (url) {
    const def = ctx.defs.get(url[1])
    return def ? gradientFrom(def, style, ctx) : null
  }
  try {
    return parseColor(value, style.color)
  } catch {
    return null
  }
}

function gradientFrom(def, style, ctx) {
  // Follow href chains for stops.
  let stopsNode = def
  for (let i = 0; i < 4 && !stopsNode.children.some((c) => c.tag === 'stop'); i++) {
    const ref = (stopsNode.attrs.href || stopsNode.attrs['xlink:href'] || '').replace(/^#/, '')
    const next = ctx.defs.get(ref)
    if (!next) break
    stopsNode = next
  }
  const stops = stopsNode.children
    .filter((c) => c.tag === 'stop')
    .map((s) => {
      const st = { ...s.attrs, ...parseStyle(s.attrs.style) }
      let offset = st.offset ?? '0'
      offset = offset.endsWith('%') ? parseFloat(offset) / 100 : num(offset)
      const c = st['stop-color'] === 'currentColor' ? style.color : st['stop-color'] ?? '#000'
      return { offset, color: c.startsWith('var(') ? (parseColor(c, style.color) ? c : '#000') : c, opacity: num(st['stop-opacity'], 1) }
    })
  const a = def.attrs
  const units = a.gradientUnits === 'userSpaceOnUse' ? 'user' : 'box'
  const val = (v, d) => {
    if (v == null) return d
    return String(v).endsWith('%') ? parseFloat(v) / 100 : num(v, d)
  }
  if (def.tag === 'radialGradient') {
    return { type: 'radial', units, cx: val(a.cx, 0.5), cy: val(a.cy, 0.5), r: val(a.r, 0.5), fx: val(a.fx, val(a.cx, 0.5)), fy: val(a.fy, val(a.cy, 0.5)), stops }
  }
  return { type: 'linear', units, x1: val(a.x1, 0), y1: val(a.y1, 0), x2: val(a.x2, 1), y2: val(a.y2, 0), stops }
}

function paint(style, ctx, inheritedOpacity, isLine, pathOps) {
  const p = ctx.painter
  const fill = isLine ? null : paintFor(style.fill, style, ctx)
  const stroke = paintFor(style.stroke, style, ctx)
  const strokeWidth = num(style['stroke-width'], 1)
  const fillOpacity = num(style['fill-opacity'], 1) * inheritedOpacity * (style.__opacity ?? 1)
  const strokeOpacity = num(style['stroke-opacity'], 1) * inheritedOpacity * (style.__opacity ?? 1)
  const rule = style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero'
  const hasStroke = stroke && !stroke.stops && strokeWidth > 0
  if (!fill && !hasStroke) {
    p.endPath()
    return
  }
  if (hasStroke) {
    p.lineWidth(strokeWidth)
    if (style['stroke-linecap']) p.lineCap(style['stroke-linecap'])
    if (style['stroke-linejoin']) p.lineJoin(style['stroke-linejoin'])
    if (style['stroke-miterlimit']) p.miterLimit(num(style['stroke-miterlimit'], 4))
    const dash = style['stroke-dasharray']
    if (dash && dash !== 'none') {
      const list = dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
      if (list.length && list.some((n) => n > 0)) p.dash(list.length % 2 ? [...list, ...list] : list, num(style['stroke-dashoffset']))
    }
  }
  if (fill?.stops) {
    // Gradient fill uses up the path; replay it for the stroke.
    const box = p.pathBox ? [...p.pathBox] : null
    if (fillOpacity < 1 || strokeOpacity < 1) p.opacity(fillOpacity, strokeOpacity)
    p.fill(fill, { rule })
    if (hasStroke) {
      for (const op of pathOps) p.op(op)
      p.pathBox = box
      p.stroke(stroke)
    }
    return
  }
  if (fillOpacity < 1 || strokeOpacity < 1 || (fill && fill.alpha < 1) || (stroke && stroke.alpha < 1)) {
    p.opacity(fillOpacity * (fill?.alpha ?? 1), strokeOpacity * (stroke?.alpha ?? 1))
    if (fill) fill.alpha = 1
    if (stroke) stroke.alpha = 1
  }
  if (fill && hasStroke) p.fillAndStroke(fill, stroke, { rule })
  else if (fill) p.fill(fill, { rule })
  else p.stroke(stroke)
}

function drawText(node, style, ctx, opacity) {
  const p = ctx.painter
  const fonts = ctx.fonts
  // Flatten <tspan>s into runs that share the text's position unless
  // they set their own x / y / dx / dy.
  let cx = num(node.attrs.x)
  let cy = num(node.attrs.y)
  const pieces = []
  const walk = (el, st) => {
    for (const child of el.children) {
      if (typeof child === 'string') {
        const text = child.replace(/\s+/g, ' ')
        if (text.trim() || pieces.length) pieces.push({ text, style: st, el })
      } else if (child.tag === 'tspan') {
        const cst = inherit(st, child, ctx)
        pieces.push({ move: child.attrs })
        walk(child, cst)
      }
    }
  }
  walk(node, style)
  // Trim leading/trailing whitespace of the whole text.
  const textPieces = pieces.filter((q) => q.text != null)
  if (textPieces.length) {
    textPieces[0].text = textPieces[0].text.replace(/^\s+/, '')
    textPieces[textPieces.length - 1].text = textPieces[textPieces.length - 1].text.replace(/\s+$/, '')
  }

  // Measure for text-anchor.
  const measured = []
  for (const q of pieces) {
    if (q.move) {
      measured.push(q)
      continue
    }
    const st = q.style
    const size = num(st['font-size'], 16)
    const weight = st['font-weight']
    const bold = weight === 'bold' || weight === 'bolder' || num(weight, 400) >= 600
    const italic = st['font-style'] === 'italic' || st['font-style'] === 'oblique'
    const resolved = fonts.resolveStyle({ font: st['font-family'] || 'Helvetica', bold, italic })
    measured.push({ ...q, size, font: resolved.font, width: (resolved.font.measure(q.text) * size) / 1000 })
  }
  const total = measured.reduce((s, q) => s + (q.width || 0), 0)
  const anchor = style['text-anchor']
  if (anchor === 'middle') cx -= total / 2
  else if (anchor === 'end') cx -= total

  for (const q of measured) {
    if (q.move) {
      if (q.move.x != null) cx = num(q.move.x)
      if (q.move.y != null) cy = num(q.move.y)
      cx += num(q.move.dx)
      cy += num(q.move.dy)
      continue
    }
    if (!q.text) continue
    const st = q.style
    const fill = paintFor(st.fill, st, ctx)
    if (!fill) {
      cx += q.width
      continue
    }
    const db = st['dominant-baseline'] || st['alignment-baseline']
    let shift = 0
    const asc = (q.font.ascent / 1000) * q.size
    const desc = (-q.font.descent / 1000) * q.size
    if (db === 'middle' || db === 'central') shift = (asc - desc) / 2 - (db === 'middle' ? q.size * 0.04 : 0)
    else if (db === 'hanging' || db === 'text-before-edge') shift = asc * 0.8
    else if (db === 'text-after-edge' || db === 'ideographic') shift = -desc
    const op = num(st['fill-opacity'], 1) * opacity * (fill.alpha ?? 1)
    p.save()
    if (op < 1) p.opacity(op)
    p.showText(q.text, cx, cy + shift, { font: q.font, size: q.size, color: { ...fill, alpha: 1 }, characterSpacing: num(st['letter-spacing']) })
    p.restore()
    cx += q.width
  }
}

function drawImage(node, ctx) {
  const href = node.attrs.href || node.attrs['xlink:href'] || ''
  if (!href.startsWith('data:')) return
  try {
    const img = openImage(decodeDataUrl(href))
    ctx.painter.doc.images.track(img)
    const w = num(node.attrs.width, img.width)
    const h = num(node.attrs.height, img.height)
    ctx.painter.image(img, num(node.attrs.x), num(node.attrs.y), w, h)
  } catch {
    // Unsupported image: skip it rather than fail the document.
  }
}

function applyTransform(p, text) {
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let m
  while ((m = re.exec(text))) {
    const v = m[2].split(/[\s,]+/).filter(Boolean).map(Number)
    switch (m[1]) {
      case 'matrix':
        p.transform(v[0], v[1], v[2], v[3], v[4], v[5])
        break
      case 'translate':
        p.translate(v[0] || 0, v[1] || 0)
        break
      case 'scale':
        p.transform(v[0], 0, 0, v[1] ?? v[0], 0, 0)
        break
      case 'rotate':
        p.rotate(v[0] || 0, v[1] || 0, v[2] || 0)
        break
      case 'skewX':
        p.transform(1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0)
        break
      case 'skewY':
        p.transform(1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0)
        break
    }
  }
}
