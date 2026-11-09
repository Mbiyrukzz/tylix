import { DEFAULT_PALETTE } from './line.js'

const TAU = Math.PI * 2
const fmt = (n) => Math.round(n * 100) / 100

// Angles start at 12 o'clock and run clockwise.
const polar = (cx, cy, r, a) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) })

/**
 * Annular sector (or pie wedge when innerRadius is 0) as SVG path data,
 * with optionally rounded corners. Render with fill-rule="evenodd" so a
 * full-circle ring keeps its hole.
 */
export function arcPath({
  cx = 0,
  cy = 0,
  innerRadius = 0,
  outerRadius = 1,
  startAngle = 0,
  endAngle = TAU,
  cornerRadius = 0,
} = {}) {
  const R = outerRadius
  const r = Math.max(0, innerRadius)
  const span = endAngle - startAngle
  if (!(span > 0) || !(R > 0)) return ''

  const P = (rad, a) => {
    const p = polar(cx, cy, rad, a)
    return `${fmt(p.x)},${fmt(p.y)}`
  }
  const A = (rad, large, sweep, to) => `A${fmt(rad)},${fmt(rad)} 0 ${large} ${sweep} ${to}`

  // Full circle / ring: an arc cannot start and end on the same point.
  if (span >= TAU - 1e-6) {
    const circle = (rad, sweep) =>
      `M${fmt(cx)},${fmt(cy - rad)}A${fmt(rad)},${fmt(rad)} 0 1 ${sweep} ${fmt(cx)},${fmt(cy + rad)}` +
      `A${fmt(rad)},${fmt(rad)} 0 1 ${sweep} ${fmt(cx)},${fmt(cy - rad)}Z`
    return r > 0 ? circle(R, 1) + circle(r, 0) : circle(R, 1)
  }

  // Corner radius limited by the ring thickness and the slice's angular width.
  let c = Math.max(0, Math.min(cornerRadius, (R - r) / 2))
  if (c > 0) {
    const s = span / 2 >= Math.PI / 2 ? 1 : Math.sin(span / 2)
    c = Math.min(c, (R * s) / (1 + s))
    if (r > 0 && s < 1) c = Math.min(c, (r * s) / (1 - s))
  }

  const large = span > Math.PI ? 1 : 0

  if (c < 0.25) {
    const arc = A(R, large, 1, P(R, endAngle))
    if (r <= 0) return `M${fmt(cx)},${fmt(cy)}L${P(R, startAngle)}${arc}Z`
    return `M${P(R, startAngle)}${arc}L${P(r, endAngle)}${A(r, large, 0, P(r, startAngle))}Z`
  }

  const dO = Math.asin(c / (R - c))
  const o0 = startAngle + dO
  const o1 = endAngle - dO
  const dist = (R - c) * Math.cos(dO)
  const largeO = o1 - o0 > Math.PI ? 1 : 0

  if (r <= 0) {
    return (
      `M${fmt(cx)},${fmt(cy)}L${P(dist, startAngle)}` +
      A(c, 0, 1, P(R, o0)) +
      A(R, largeO, 1, P(R, o1)) +
      A(c, 0, 1, P(dist, endAngle)) +
      'Z'
    )
  }

  const dI = Math.asin(c / (r + c))
  const i0 = startAngle + dI
  const i1 = endAngle - dI
  const distI = (r + c) * Math.cos(dI)
  const largeI = i1 - i0 > Math.PI ? 1 : 0

  return (
    `M${P(distI, startAngle)}L${P(dist, startAngle)}` +
    A(c, 0, 1, P(R, o0)) +
    A(R, largeO, 1, P(R, o1)) +
    A(c, 0, 1, P(dist, endAngle)) +
    `L${P(distI, endAngle)}` +
    A(c, 0, 1, P(r, i1)) +
    A(r, largeI, 0, P(r, i0)) +
    A(c, 0, 1, P(distI, startAngle)) +
    'Z'
  )
}

/**
 * Computes pie / donut geometry.
 *
 * data: [{ label, value, color? }] or plain numbers
 * options:
 *   width, height     - box size (chart is centered, radius = min / 2 - margin)
 *   innerRadius       - 0..1, fraction of the outer radius (0 = pie)
 *   cornerRadius      - px, rounded slice corners
 *   gap               - px gap between slices
 *   startAngle        - degrees, 0 = 12 o'clock
 *   sort              - 'none' | 'desc' | 'asc'
 *   margin            - px kept free around the chart
 */
export function pieChart(
  data = [],
  {
    width = 240,
    height = width,
    innerRadius = 0,
    cornerRadius = 4,
    gap = 2,
    startAngle = 0,
    sort = 'none',
    margin = 4,
    formatValue = (v) => String(v),
    formatPercent = (p) => (p > 0 && p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`),
  } = {}
) {
  const items = data.map((d, i) => {
    const o = typeof d === 'number' ? { value: d } : d ?? {}
    const value = typeof o.value === 'number' && Number.isFinite(o.value) && o.value > 0 ? o.value : 0
    return {
      index: i,
      label: o.label ?? `Item ${i + 1}`,
      value,
      color: o.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    }
  })
  if (sort === 'desc') items.sort((a, b) => b.value - a.value)
  else if (sort === 'asc') items.sort((a, b) => a.value - b.value)

  const total = items.reduce((sum, d) => sum + d.value, 0)
  const cx = width / 2
  const cy = height / 2
  const outer = Math.max(0, Math.min(width, height) / 2 - margin)
  const inner = outer * Math.min(0.95, Math.max(0, innerRadius))
  const mid = (outer + inner) / 2
  const visible = items.filter((d) => d.value > 0).length
  const pad = visible > 1 && mid > 0 ? gap / mid : 0

  let angle = (startAngle * Math.PI) / 180
  const slices = items.map((d) => {
    const percent = total > 0 ? d.value / total : 0
    const a0 = angle
    const a1 = angle + percent * TAU
    angle = a1
    const mA = (a0 + a1) / 2
    let s0 = a0 + pad / 2
    let s1 = a1 - pad / 2
    if (s1 <= s0) {
      s0 = a0
      s1 = a1
    }
    const labelPt = polar(cx, cy, outer + 14, mA)
    const center = polar(cx, cy, mid, mA)
    return {
      index: d.index,
      label: d.label,
      value: d.value,
      valueLabel: formatValue(d.value),
      percent,
      percentLabel: formatPercent(percent),
      color: d.color,
      startAngle: a0,
      endAngle: a1,
      midAngle: mA,
      path:
        percent > 0
          ? arcPath({
              cx, cy, innerRadius: inner, outerRadius: outer,
              startAngle: s0, endAngle: s1, cornerRadius,
            })
          : '',
      centroid: { x: center.x, y: center.y },
      labelPoint: { x: labelPt.x, y: labelPt.y },
    }
  })

  return { width, height, cx, cy, outerRadius: outer, innerRadius: inner, total, slices }
}

/** pieChart() with a hole in the middle (innerRadius defaults to 0.62). */
export function donutChart(data, options = {}) {
  return pieChart(data, { innerRadius: 0.62, ...options })
}
