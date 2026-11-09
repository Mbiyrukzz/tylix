import { linearScale } from './scales.js'
import { bandScale } from './band.js'
import { extent } from './ticks.js'
import { DEFAULT_PALETTE } from './line.js'

const fmt = (n) => Math.round(n * 100) / 100
const f = fmt

/**
 * Rect path with only the outer end rounded.
 * side: 'top' | 'bottom' | 'left' | 'right' | 'none'
 */
export function roundedBarPath(x, y, w, h, r = 0, side = 'none') {
  if (!(w > 0) || !(h > 0)) return ''
  const vertical = side === 'top' || side === 'bottom'
  r =
    side === 'none'
      ? 0
      : Math.max(0, Math.min(r, vertical ? w / 2 : h / 2, vertical ? h : w))
  const x2 = x + w
  const y2 = y + h
  if (r < 0.01) return `M${f(x)},${f(y)}H${f(x2)}V${f(y2)}H${f(x)}Z`
  const a = `A${f(r)},${f(r)} 0 0 `
  switch (side) {
    case 'top':
      return `M${f(x)},${f(y2)}V${f(y + r)}${a}1 ${f(x + r)},${f(y)}H${f(x2 - r)}${a}1 ${f(x2)},${f(y + r)}V${f(y2)}Z`
    case 'bottom':
      return `M${f(x)},${f(y)}V${f(y2 - r)}${a}0 ${f(x + r)},${f(y2)}H${f(x2 - r)}${a}0 ${f(x2)},${f(y2 - r)}V${f(y)}Z`
    case 'right':
      return `M${f(x)},${f(y)}H${f(x2 - r)}${a}1 ${f(x2)},${f(y + r)}V${f(y2 - r)}${a}1 ${f(x2 - r)},${f(y2)}H${f(x)}Z`
    default: // left
      return `M${f(x2)},${f(y)}H${f(x + r)}${a}0 ${f(x)},${f(y + r)}V${f(y2 - r)}${a}0 ${f(x + r)},${f(y2)}H${f(x2)}Z`
  }
}

/**
 * Computes bar chart geometry (grouped, stacked, vertical or horizontal).
 *
 * series: [{ name, color?, data: Array<number | null> }]
 * options.categories: labels for each position along the category axis.
 */
export function barChart(
  series = [],
  {
    categories,
    orientation = 'vertical',
    stacked = false,
    width = 480,
    height = 240,
    margin = {},
    yDomain,
    yTicks = 5,
    zeroBaseline = true,
    padding = 0.3,
    groupPadding = 0.08,
    radius = 4,
    formatValue = (v) => String(v),
    formatCategory = (c) => String(c),
  } = {}
) {
  const horizontal = orientation === 'horizontal'
  const norm = series.map((s, i) => ({
    name: s.name ?? `Series ${i + 1}`,
    color: s.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    data: (s.data ?? []).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)),
  }))
  const count = categories?.length ?? Math.max(0, ...norm.map((s) => s.data.length))
  const cats = categories ?? Array.from({ length: count }, (_, i) => String(i + 1))
  const idx = cats.map((_, i) => i)

  const labelW = horizontal
    ? Math.min(140, Math.max(0, ...cats.map((c) => formatCategory(c).length)) * 6.2 + 16)
    : 0
  const m = {
    top: 12,
    right: horizontal ? 24 : 12,
    bottom: 28,
    left: horizontal ? Math.max(40, labelW) : 40,
    ...margin,
  }
  const plot = {
    x: m.left,
    y: m.top,
    width: Math.max(0, width - m.left - m.right),
    height: Math.max(0, height - m.top - m.bottom),
  }

  // ---- value domain
  const valueAt = (s, i) => s.data[i] ?? null
  let vals
  if (stacked) {
    const pos = cats.map(() => 0)
    const neg = cats.map(() => 0)
    norm.forEach((s) =>
      cats.forEach((_, i) => {
        const v = valueAt(s, i)
        if (v === null) return
        if (v >= 0) pos[i] += v
        else neg[i] += v
      })
    )
    vals = [...pos, ...neg]
  } else {
    vals = norm.flatMap((s) => s.data.filter((v) => v !== null))
  }
  let ext = extent(vals) ?? [0, 1]
  if (zeroBaseline || stacked) ext = [Math.min(0, ext[0]), Math.max(0, ext[1])]
  let vd = yDomain ?? ext
  if (!yDomain) {
    if (vd[0] === vd[1]) vd = vd[0] === 0 ? [0, 1] : [vd[0] - 1, vd[1] + 1]
    else {
      const t = linearScale({ domain: vd }).ticks(yTicks)
      if (t.length > 1) vd = [t[0], t[t.length - 1]]
    }
  }

  const vRange = horizontal ? [plot.x, plot.x + plot.width] : [plot.y + plot.height, plot.y]
  const cRange = horizontal ? [plot.y, plot.y + plot.height] : [plot.x, plot.x + plot.width]
  const vScale = linearScale({ domain: vd, range: vRange })
  const band = bandScale({ domain: idx, range: cRange, padding })
  const grouped = !stacked && norm.length > 1
  const inner = grouped
    ? bandScale({
        domain: norm.map((_, i) => i),
        range: [0, band.bandwidth()],
        paddingInner: groupPadding,
        paddingOuter: 0,
      })
    : null
  const thickness = grouped ? inner.bandwidth() : band.bandwidth()
  const base = Math.min(Math.max(0, vd[0]), vd[1])

  // ---- which stacked segment is outermost (gets the rounded end)
  const lastPos = cats.map(() => -1)
  const lastNeg = cats.map(() => -1)
  norm.forEach((s, si) =>
    cats.forEach((_, i) => {
      const v = valueAt(s, i)
      if (v === null || v === 0) return
      if (v > 0) lastPos[i] = si
      else lastNeg[i] = si
    })
  )

  const posCum = cats.map(() => 0)
  const negCum = cats.map(() => 0)

  const out = norm.map((s, si) => ({
    name: s.name,
    color: s.color,
    bars: cats.map((cat, i) => {
      const v = valueAt(s, i)
      const empty = {
        index: i, category: cat, categoryLabel: formatCategory(cat), value: v,
        label: v === null ? '' : formatValue(v), x: 0, y: 0, width: 0, height: 0, path: '',
      }
      if (v === null || v === 0) return empty

      let a
      let b
      if (!stacked) {
        a = base
        b = v
      } else if (v > 0) {
        a = posCum[i]
        b = a + v
        posCum[i] = b
      } else {
        a = negCum[i]
        b = a + v
        negCum[i] = b
      }
      const pa = vScale(a)
      const pb = vScale(b)
      const lo = Math.min(pa, pb)
      const size = Math.abs(pa - pb)
      const offset = grouped ? inner(si) : 0
      const start = band(i) + offset

      const round = !stacked || (v > 0 ? lastPos[i] === si : lastNeg[i] === si)
      const side = !round
        ? 'none'
        : horizontal
          ? (v > 0 ? 'right' : 'left')
          : (v > 0 ? 'top' : 'bottom')

      const box = horizontal
        ? { x: lo, y: start, width: size, height: thickness }
        : { x: start, y: lo, width: thickness, height: size }
      return {
        ...empty,
        ...box,
        path: roundedBarPath(box.x, box.y, box.width, box.height, radius, side),
      }
    }),
  }))

  return {
    width,
    height,
    plot,
    orientation: horizontal ? 'horizontal' : 'vertical',
    stacked,
    baseline: vScale(base),
    valueScale: vScale,
    categoryScale: band,
    valueTicks: vScale
      .ticks(yTicks)
      .filter((v) => v >= vd[0] && v <= vd[1])
      .map((v) => ({ value: v, pos: vScale(v), label: formatValue(v) })),
    categoryTicks: cats.map((c, i) => ({
      index: i,
      label: formatCategory(c),
      pos: band.center(i),
    })),
    series: out,
  }
}
