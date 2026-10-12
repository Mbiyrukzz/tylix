import { linearScale } from './scales.js'
import { linePath, areaPath } from './path.js'
import { extent } from './ticks.js'

/**
 * Computes sparkline geometry from an array of numbers (or null for gaps).
 * Returns plain data so a .tyx template can render it:
 *
 *   <svg width="{{ s.width }}" height="{{ s.height }}">
 *     <path d="{{ s.areaPath }}" />
 *     <path d="{{ s.path }}" />
 *   </svg>
 */
export function sparkline(
  data = [],
  { width = 120, height = 32, padding = 2, curve = 'linear', min, max } = {}
) {
  const values = data.map((v) => (typeof v === 'number' ? v : null))
  const ext = extent(values)

  if (!ext) {
    return { width, height, path: '', areaPath: '', last: null, min: null, max: null }
  }

  const lo = min ?? ext[0]
  const hi = max ?? ext[1]
  // A flat series would collapse to a line on the edge, so pad the domain.
  const flat = lo === hi
  const domain = flat ? [lo - 1, hi + 1] : [lo, hi]

  const x = linearScale({
    domain: [0, Math.max(values.length - 1, 1)],
    range: [padding, width - padding],
  })
  const y = linearScale({ domain, range: [height - padding, padding] })

  const points = values.map((v, i) =>
    v === null ? null : { x: x(i), y: y(v), value: v, index: i }
  )

  let last = null
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]) {
      last = points[i]
      break
    }
  }

  return {
    width,
    height,
    path: linePath(points, { curve }),
    areaPath: areaPath(points, height - padding, { curve }),
    last,
    min: ext[0],
    max: ext[1],
  }
}
