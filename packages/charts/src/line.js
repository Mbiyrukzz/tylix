import { linearScale } from './scales.js'
import { linePath, areaPath } from './path.js'
import { extent } from './ticks.js'

export const DEFAULT_PALETTE = [
  'var(--tylix-chart-1, #2563eb)',
  'var(--tylix-chart-2, #16a34a)',
  'var(--tylix-chart-3, #f59e0b)',
  'var(--tylix-chart-4, #dc2626)',
  'var(--tylix-chart-5, #7c3aed)',
]

// Accepts [1, 2, 3] (x = index) or [{ x, y }, ...]
function normalizeData(data = []) {
  return data.map((d, i) => {
    if (typeof d === 'number') return { x: i, y: d }
    if (d == null) return { x: i, y: null }
    return { x: d.x ?? i, y: d.y ?? null }
  })
}

/**
 * Computes line chart geometry. Returns plain data so a .tyx template can
 * render it with {{#each}}, or pass it to lineChartSvg() for a string.
 *
 * series: [{ name, color?, data: number[] | { x, y }[] }]
 */
export function lineChart(
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
    area = false,
    zeroBaseline = false,
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

  const allPoints = normalized.flatMap((s) => s.data)
  const xExt = extent(allPoints.map((p) => p.x)) ?? [0, 1]
  const yExt = extent(allPoints.map((p) => p.y)) ?? [0, 1]

  const xd = xDomain ?? xExt
  let yd = yDomain ?? yExt
  if (!yDomain) {
    if (zeroBaseline) yd = [Math.min(0, yd[0]), Math.max(0, yd[1])]
    // Extend to nice tick bounds so gridlines frame the data.
    const ticks = linearScale({ domain: yd }).ticks(yTicks)
    if (ticks.length > 1) yd = [ticks[0], ticks[ticks.length - 1]]
    else if (yd[0] === yd[1]) yd = [yd[0] - 1, yd[1] + 1]
  }

  const x = linearScale({ domain: xd, range: [plot.x, plot.x + plot.width] })
  const y = linearScale({ domain: yd, range: [plot.y + plot.height, plot.y] })
  // Fill down to zero when it is inside the domain, otherwise to the bottom edge.
  const baselineY = yd[0] <= 0 && yd[1] >= 0 ? y(0) : y(yd[0])

  return {
    width,
    height,
    plot,
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
    series: normalized.map((s) => {
      const points = s.data.map((p) => ({
        value: p.y,
        x: p.x,
        px: x(p.x),
        py: p.y === null ? null : y(p.y),
      }))
      const px = points.map((p) => ({ x: p.px, y: p.py }))
      return {
        name: s.name,
        color: s.color,
        points,
        path: linePath(px, { curve }),
        areaPath: area ? areaPath(px, baselineY, { curve }) : '',
      }
    }),
  }
}
