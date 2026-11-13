import { arcPath } from './pie.js'

const RAD = Math.PI / 180

/**
 * Radial gauge geometry (a meter from min to max).
 *
 *   gauge(72, { min: 0, max: 100, thresholds: [
 *     { value: 0, color: '#16a34a' }, { value: 70, color: '#f59e0b' }, { value: 90, color: '#dc2626' },
 *   ] })
 *
 * Angles are in degrees from 12 o'clock, clockwise (default -120..120).
 * thresholds colour the value arc by the band the value falls in and
 * are drawn as a thin band under the track when `bands` is true.
 *
 * Returns { size, cx, cy, track, value, color, angle, needle: { x, y },
 *   percent, label, min, max, bands: [{ path, color }] }
 */
export function gauge(
  value,
  {
    min = 0,
    max = 100,
    size = 200,
    thickness = 0.16,
    startAngle = -120,
    endAngle = 120,
    cornerRadius = 4,
    thresholds = [],
    bands = false,
    color = 'var(--tylix-chart-1, #2563eb)',
    format = (v) => String(Math.round(v * 10) / 10),
  } = {},
) {
  const r = size / 2
  const cx = r
  const cy = r
  // leave room outside the track for the threshold bands
  const outer = r - (bands ? 9 : 2)
  const inner = outer - Math.max(4, outer * thickness * 2)
  const v = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  const t = max === min ? 0 : (v - min) / (max - min)
  const a0 = startAngle * RAD
  const a1 = endAngle * RAD
  const at = a0 + t * (a1 - a0)

  const sorted = [...thresholds].sort((a, b) => a.value - b.value)
  const band = sorted.filter((b) => v >= b.value).at(-1)
  const fill = band?.color ?? color

  const arc = (from, to, ir = inner, or = outer, cr = cornerRadius) =>
    arcPath({ cx, cy, innerRadius: ir, outerRadius: or, startAngle: from, endAngle: to, cornerRadius: cr })

  const angleOf = (x) => a0 + ((Math.min(max, Math.max(min, x)) - min) / (max - min || 1)) * (a1 - a0)
  const bandArcs = bands
    ? sorted.map((b, i) => ({
        color: b.color,
        path: arc(angleOf(b.value), angleOf(sorted[i + 1]?.value ?? max), outer + 3, outer + 6, 0),
      }))
    : []

  const needleR = inner - 6
  return {
    size,
    cx,
    cy,
    min,
    max,
    value: v,
    percent: t,
    angle: Math.round((at / RAD) * 1e6) / 1e6,
    color: fill,
    label: format(v),
    track: arc(a0, a1),
    valuePath: t > 0 ? arc(a0, at) : '',
    needle: { x: cx + needleR * Math.sin(at), y: cy - needleR * Math.cos(at) },
    bands: bandArcs,
    // the lowest point the arc reaches, to size the SVG
    bottom: Math.max(cy + outer * Math.max(-Math.cos(a0), -Math.cos(a1), 0), cy + 8),
  }
}
