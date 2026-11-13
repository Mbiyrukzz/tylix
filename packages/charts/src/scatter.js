import { linearScale } from './scales.js'
import { extent } from './ticks.js'
import { DEFAULT_PALETTE, xAxis, anchorTicks } from './line.js'
import { toTime, isDate } from './time.js'

/**
 * Scatter / bubble chart geometry.
 *
 * series: [{ name, color?, data: [{ x, y, size?, label? }] }]
 * x may be a number or a Date. With `size` on points it becomes a
 * bubble chart: radius grows with the square root of size (area is
 * proportional to the value), between radius[0] and radius[1].
 *
 * Returns { width, height, plot, xTicks, yTicks, series: [{ name,
 * color, points: [{ x, y, size, label, px, py, r }] }], formatX, time }
 */
export function scatterChart(
  series = [],
  {
    width = 480,
    height = 280,
    margin = {},
    xDomain,
    yDomain,
    xTicks = 6,
    yTicks = 5,
    radius = [4, 22],
    pointRadius = 4.5,
    formatX,
    formatY = (v) => String(v),
    timeZone,
    locale,
  } = {},
) {
  const m = { top: 12, right: 16, bottom: 28, left: 44, ...margin }
  const plot = {
    x: m.left,
    y: m.top,
    width: Math.max(0, width - m.left - m.right),
    height: Math.max(0, height - m.top - m.bottom),
  }
  const normalized = series.map((s, i) => ({
    name: s.name ?? `Series ${i + 1}`,
    color: s.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    data: (s.data ?? [])
      .map((d) => ({ x: toTime(d.x), y: d.y, size: d.size ?? null, label: d.label ?? null }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y)),
  }))
  const all = normalized.flatMap((s) => s.data)
  const pad = (ext) => {
    if (!ext) return [0, 1]
    if (ext[0] === ext[1]) return [ext[0] - 1, ext[1] + 1]
    const t = linearScale({ domain: ext }).ticks(5)
    return t.length > 1 ? [t[0], t.at(-1)] : ext
  }
  const time = series.some((s) => (s.data ?? []).some((d) => isDate(d?.x)))
  const xd = xDomain?.map(toTime) ?? (time ? extent(all.map((d) => d.x)) ?? [0, 1] : pad(extent(all.map((d) => d.x))))
  const yd = yDomain ?? pad(extent(all.map((d) => d.y)))
  // inset by the largest radius so edge points are not clipped
  const inset = Math.min(plot.width / 4, plot.height / 4, all.some((d) => d.size != null) ? radius[1] : pointRadius + 1)
  const x = linearScale({ domain: xd, range: [plot.x + inset, plot.x + plot.width - inset] })
  const y = linearScale({ domain: yd, range: [plot.y + plot.height - inset, plot.y + inset] })
  const xa = xAxis(series, x, xd, xTicks, { formatX, timeZone, locale })

  const sizes = extent(all.map((d) => d.size))
  const rOf = (size) => {
    if (size == null || !sizes) return pointRadius
    const [lo, hi] = sizes
    const t = hi === lo ? 1 : (Math.sqrt(Math.max(0, size)) - Math.sqrt(Math.max(0, lo))) / (Math.sqrt(hi) - Math.sqrt(Math.max(0, lo)))
    return radius[0] + t * (radius[1] - radius[0])
  }

  return {
    width,
    height,
    plot,
    time: xa.time,
    formatX: xa.format,
    formatY,
    xScale: x,
    yScale: y,
    xTicks: anchorTicks(xa.ticks, width),
    yTicks: y.ticks(yTicks).filter((v) => v >= yd[0] && v <= yd[1]).map((v) => ({ value: v, y: y(v), label: formatY(v) })),
    series: normalized.map((s) => ({
      name: s.name,
      color: s.color,
      // biggest first, so small bubbles stay on top
      points: s.data
        .map((d) => ({ ...d, px: x(d.x), py: y(d.y), r: rOf(d.size) }))
        .sort((a, b) => b.r - a.r),
    })),
  }
}

/** The point under (px, py), or the nearest within `max` pixels. */
export function nearestScatterPoint(chart, px, py, max = 24) {
  let best = null
  let bestD = Infinity
  for (const s of chart.series) {
    for (const p of s.points) {
      const d = Math.hypot(p.px - px, p.py - py) - p.r
      if (d < bestD) {
        bestD = d
        best = { ...p, name: s.name, color: s.color }
      }
    }
  }
  return best && bestD <= max ? best : null
}
