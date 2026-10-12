// SVG path-data builders. Points are { x, y } in pixel space.
// A point with a null / non-finite x or y breaks the line (a gap).

const fmt = (n) => Math.round(n * 100) / 100

const isValid = (p) =>
  p != null &&
  typeof p.x === 'number' &&
  typeof p.y === 'number' &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y)

/** Splits points into runs of consecutive valid points. */
export function segments(points) {
  const runs = []
  let current = []
  for (const p of points) {
    if (isValid(p)) {
      current.push(p)
    } else if (current.length) {
      runs.push(current)
      current = []
    }
  }
  if (current.length) runs.push(current)
  return runs
}

function runPath(run, curve) {
  let d = `M${fmt(run[0].x)},${fmt(run[0].y)}`
  for (let i = 1; i < run.length; i++) {
    const p = run[i]
    d +=
      curve === 'step'
        ? `H${fmt(p.x)}V${fmt(p.y)}`
        : `L${fmt(p.x)},${fmt(p.y)}`
  }
  return d
}

/**
 * Line path. curve: 'linear' (default) | 'step'.
 * A lone point renders as a zero-length segment so it stays visible with round caps.
 */
export function linePath(points, { curve = 'linear' } = {}) {
  return segments(points)
    .map((run) =>
      run.length === 1
        ? `M${fmt(run[0].x)},${fmt(run[0].y)}h0`
        : runPath(run, curve)
    )
    .join('')
}

/** Closed area path between the line and a horizontal baseline (pixel y). */
export function areaPath(points, baselineY, { curve = 'linear' } = {}) {
  return segments(points)
    .filter((run) => run.length > 1)
    .map((run) => {
      const first = run[0]
      const last = run[run.length - 1]
      return (
        runPath(run, curve) +
        `L${fmt(last.x)},${fmt(baselineY)}L${fmt(first.x)},${fmt(baselineY)}Z`
      )
    })
    .join('')
}
