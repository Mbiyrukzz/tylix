import { linearScale } from './scales.js'
import { linePath, bandPath } from './path.js'
import { extent } from './ticks.js'
import { DEFAULT_PALETTE, normalizeData } from './line.js'

/**
 * Computes area chart geometry. Same shape as lineChart() plus `py0` (the
 * lower edge of each point) so stacked bands can be drawn.
 *
 * stacked: series are summed per x position (index-aligned, null counts as 0,
 * values are expected to be >= 0).
 */
export function areaChart(
  series = [],
  {
    width = 480,
    height = 240,
    margin = {},
    xDomain,
    yDomain,
    xTicks = 6,
    yTicks = 5,
    curve = 'linear',
    stacked = false,
    zeroBaseline = true,
    formatX = (v) => String(v),
    formatY = (v) => String(v),
  } = {}
) {
  const m = { top: 12, right: 12, bottom: 28, left: 40, ...margin }
  const plot = {
    x: m.left,
    y: m.top,
    width: Math.max(0, width - m.left - m.right),
    height: Math.max(0, height - m.top - m.bottom),
  }

  const normalized = series.map((s, i) => ({
    name: s.name ?? `Series ${i + 1}`,
    color: s.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    data: normalizeData(s.data),
  }))

  const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  let layers
  if (stacked) {
    const longest = normalized.reduce((a, s) => (s.data.length > a.length ? s.data : a), [])
    const totals = longest.map(() => 0)
    layers = normalized.map((s) =>
      longest.map((ref, i) => {
        const raw = finite(s.data[i]?.y)
        const lo = totals[i]
        totals[i] += raw ?? 0
        return { x: ref.x, value: raw, lo, hi: totals[i] }
      })
    )
  } else {
    layers = normalized.map((s) =>
      s.data.map((p) => ({ x: p.x, value: finite(p.y), lo: null, hi: finite(p.y) }))
    )
  }

  const flat = layers.flat()
  const xExt = extent(flat.map((p) => p.x)) ?? [0, 1]
  const yVals = flat.flatMap((p) => (p.hi === null ? [] : stacked ? [p.hi, p.lo] : [p.hi]))
  let yExt = extent(yVals) ?? [0, 1]
  if (zeroBaseline || stacked) yExt = [Math.min(0, yExt[0]), Math.max(0, yExt[1])]

  const xd = xDomain ?? xExt
  let yd = yDomain ?? yExt
  if (!yDomain) {
    if (yd[0] === yd[1]) yd = yd[0] === 0 ? [0, 1] : [yd[0] - 1, yd[1] + 1]
    else {
      const t = linearScale({ domain: yd }).ticks(yTicks)
      if (t.length > 1) yd = [t[0], t[t.length - 1]]
    }
  }

  const x = linearScale({ domain: xd, range: [plot.x, plot.x + plot.width] })
  const y = linearScale({ domain: yd, range: [plot.y + plot.height, plot.y] })
  const baselineY = yd[0] <= 0 && yd[1] >= 0 ? y(0) : y(yd[0])

  return {
    width,
    height,
    plot,
    stacked,
    xScale: x,
    yScale: y,
    xTicks: x.ticks(xTicks).filter((v) => v >= xd[0] && v <= xd[1]).map((v) => ({
      value: v,
      x: x(v),
      label: formatX(v),
    })),
    yTicks: y.ticks(yTicks).filter((v) => v >= yd[0] && v <= yd[1]).map((v) => ({
      value: v,
      y: y(v),
      label: formatY(v),
    })),
    series: normalized.map((s, si) => {
      const points = layers[si].map((p) => ({
        value: p.value,
        x: p.x,
        px: x(p.x),
        py: p.hi === null ? null : y(p.hi),
        py0: stacked ? y(p.lo) : baselineY,
      }))
      const top = points.map((p) => ({ x: p.px, y: p.py, y0: p.py0 }))
      return {
        name: s.name,
        color: s.color,
        points,
        path: linePath(top, { curve }),
        areaPath: bandPath(top, { curve }),
      }
    }),
  }
}
