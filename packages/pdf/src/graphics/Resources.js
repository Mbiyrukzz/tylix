// The resource dictionary every page shares: fonts, images, graphics
// states (opacity, soft masks) and shadings (gradients).

import { parseColor } from '../util/color.js'

export class Resources {
  constructor(writer) {
    this.writer = writer
    this.fonts = new Map() // font -> name
    this.xobjects = new Map() // ref id -> { name, ref }
    this.states = new Map() // key -> { name, ref }
    this.shadings = new Map()
    this.counter = { F: 0, Im: 0, GS: 0, Sh: 0, Fm: 0 }
  }

  next(prefix) {
    return prefix + ++this.counter[prefix]
  }

  font(font) {
    let name = this.fonts.get(font)
    if (!name) {
      name = this.next('F')
      this.fonts.set(font, name)
      font.embed(this.writer)
    }
    return name
  }

  xobject(ref, prefix = 'Im') {
    let entry = this.xobjects.get(ref.id)
    if (!entry) {
      entry = { name: this.next(prefix), ref }
      this.xobjects.set(ref.id, entry)
    }
    return entry.name
  }

  // Constant opacity: fill (ca) and stroke (CA).
  opacity(fill = 1, stroke = 1) {
    const key = `o:${fill}:${stroke}`
    let entry = this.states.get(key)
    if (!entry) {
      entry = { name: this.next('GS'), ref: this.writer.add({ Type: '/ExtGState', ca: fill, CA: stroke }) }
      this.states.set(key, entry)
    }
    return entry.name
  }

  // A graphics state whose soft mask is a form XObject (luminosity).
  softMask(formRef) {
    const name = this.next('GS')
    const ref = this.writer.add({ Type: '/ExtGState', SMask: { Type: '/Mask', S: '/Luminosity', G: formRef } })
    this.states.set(name, { name, ref })
    return name
  }

  // Axial (linear) or radial shading from gradient stops.
  shading(gradient) {
    const key = JSON.stringify(gradient)
    let entry = this.shadings.get(key)
    if (entry) return entry.name
    const stops = normalizeStops(gradient.stops)
    const fn = stopsFunction(stops.map((s) => ({ offset: s.offset, values: s.color.values })))
    const coords = gradient.type === 'radial'
      ? [gradient.fx ?? gradient.cx, gradient.fy ?? gradient.cy, 0, gradient.cx, gradient.cy, gradient.r]
      : [gradient.x1, gradient.y1, gradient.x2, gradient.y2]
    const ref = this.writer.add({
      ShadingType: gradient.type === 'radial' ? 3 : 2,
      ColorSpace: '/DeviceRGB',
      Coords: coords,
      Function: fn,
      Extend: [true, true],
    })
    entry = { name: this.next('Sh'), ref, stops }
    this.shadings.set(key, entry)
    return entry.name
  }

  // A gray shading of the stop opacities (for a gradient soft mask).
  alphaShading(gradient) {
    const stops = normalizeStops(gradient.stops)
    const fn = stopsFunction(stops.map((s) => ({ offset: s.offset, values: [s.opacity] })))
    const coords = gradient.type === 'radial'
      ? [gradient.fx ?? gradient.cx, gradient.fy ?? gradient.cy, 0, gradient.cx, gradient.cy, gradient.r]
      : [gradient.x1, gradient.y1, gradient.x2, gradient.y2]
    return this.writer.add({
      ShadingType: gradient.type === 'radial' ? 3 : 2,
      ColorSpace: '/DeviceGray',
      Coords: coords,
      Function: fn,
      Extend: [true, true],
    })
  }

  toDict() {
    const dict = { ProcSet: ['/PDF', '/Text', '/ImageB', '/ImageC', '/ImageI'] }
    if (this.fonts.size) dict.Font = Object.fromEntries([...this.fonts].map(([font, name]) => [name, font.ref]))
    if (this.xobjects.size) dict.XObject = Object.fromEntries([...this.xobjects.values()].map((e) => [e.name, e.ref]))
    if (this.states.size) dict.ExtGState = Object.fromEntries([...this.states.values()].map((e) => [e.name, e.ref]))
    if (this.shadings.size) dict.Shading = Object.fromEntries([...this.shadings.values()].map((e) => [e.name, e.ref]))
    return dict
  }
}

export function normalizeStops(stops) {
  const list = stops.map((s) => {
    const color = parseColor(s.color ?? '#000') ?? { values: [0, 0, 0], alpha: 0 }
    return {
      offset: Math.min(1, Math.max(0, Number(s.offset) || 0)),
      color: color.space === 'cmyk' ? cmykToRgb(color) : color,
      opacity: (s.opacity ?? 1) * (color.alpha ?? 1),
    }
  })
  if (!list.length) list.push({ offset: 0, color: { values: [0, 0, 0] }, opacity: 1 })
  if (list.length === 1) list.push({ ...list[0], offset: 1 })
  for (let i = 1; i < list.length; i++) if (list[i].offset < list[i - 1].offset) list[i].offset = list[i - 1].offset
  return list
}

function cmykToRgb({ values: [c, m, y, k] }) {
  return { space: 'rgb', values: [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)], alpha: 1 }
}

function stopsFunction(stops) {
  const pieces = []
  for (let i = 0; i < stops.length - 1; i++) {
    pieces.push({ FunctionType: 2, Domain: [0, 1], C0: stops[i].values, C1: stops[i + 1].values, N: 1 })
  }
  if (pieces.length === 1 && stops[0].offset === 0 && stops[1].offset === 1) return pieces[0]
  const bounds = stops.slice(1, -1).map((s) => s.offset)
  // Pad the ends so offsets that don't start at 0 / end at 1 still work.
  const first = stops[0]
  const last = stops[stops.length - 1]
  const fns = [...pieces]
  const allBounds = [...bounds]
  if (first.offset > 0) {
    fns.unshift({ FunctionType: 2, Domain: [0, 1], C0: first.values, C1: first.values, N: 1 })
    allBounds.unshift(first.offset)
  }
  if (last.offset < 1) {
    fns.push({ FunctionType: 2, Domain: [0, 1], C0: last.values, C1: last.values, N: 1 })
    allBounds.push(last.offset)
  }
  if (fns.length === 1) return fns[0]
  return { FunctionType: 3, Domain: [0, 1], Functions: fns, Bounds: allBounds, Encode: fns.flatMap(() => [0, 1]) }
}
