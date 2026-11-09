// SVG path-data builders. Points are { x, y } in pixel space.
// A point with a null / non-finite x or y breaks the line (a gap).
// Curves: 'linear' (default) | 'step' | 'smooth' (monotone cubic, never overshoots).

const fmt = (n) => Math.round(n * 100) / 100
const pt = (x, y) => `${fmt(x)},${fmt(y)}`

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

// Monotone-X tangents (Fritsch–Carlson, as in d3.curveMonotoneX).
function tangents(run) {
  const n = run.length
  const dx = []
  const m = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = run[i + 1].x - run[i].x
    m[i] = (run[i + 1].y - run[i].y) / dx[i]
  }
  const t = new Array(n)
  if (n === 2) {
    t[0] = t[1] = m[0]
    return t
  }
  for (let i = 1; i < n - 1; i++) {
    const s0 = m[i - 1]
    const s1 = m[i]
    if (s0 * s1 <= 0) {
      t[i] = 0
      continue
    }
    const p = (s0 * dx[i] + s1 * dx[i - 1]) / (dx[i - 1] + dx[i])
    t[i] =
      (Math.sign(s0) + Math.sign(s1)) *
      Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p))
  }
  t[0] = (3 * m[0] - t[1]) / 2
  t[n - 1] = (3 * m[n - 2] - t[n - 2]) / 2
  return t
}

const strictlyIncreasing = (run) => run.every((p, i) => i === 0 || p.x > run[i - 1].x)

// One cubic Bézier per segment: { c1, c2, to }
function cubics(run) {
  const t = tangents(run)
  return run.slice(1).map((p, i) => {
    const a = run[i]
    const d = (p.x - a.x) / 3
    return { c1: [a.x + d, a.y + t[i] * d], c2: [p.x - d, p.y - t[i + 1] * d], to: p }
  })
}

const useSmooth = (run, curve) => curve === 'smooth' && run.length > 2 && strictlyIncreasing(run)

function runPath(run, curve) {
  let d = `M${pt(run[0].x, run[0].y)}`
  if (useSmooth(run, curve)) {
    for (const s of cubics(run)) {
      d += `C${pt(...s.c1)} ${pt(...s.c2)} ${pt(s.to.x, s.to.y)}`
    }
    return d
  }
  for (let i = 1; i < run.length; i++) {
    const p = run[i]
    d += curve === 'step' ? `H${fmt(p.x)}V${fmt(p.y)}` : `L${pt(p.x, p.y)}`
  }
  return d
}

// Draws the run backwards, assuming the pen already sits on its last point.
function reversePath(run, curve) {
  let d = ''
  if (useSmooth(run, curve)) {
    const cs = cubics(run)
    for (let i = cs.length - 1; i >= 0; i--) {
      d += `C${pt(...cs[i].c2)} ${pt(...cs[i].c1)} ${pt(run[i].x, run[i].y)}`
    }
    return d
  }
  for (let i = run.length - 1; i > 0; i--) {
    d +=
      curve === 'step'
        ? `V${fmt(run[i - 1].y)}H${fmt(run[i - 1].x)}`
        : `L${pt(run[i - 1].x, run[i - 1].y)}`
  }
  return d
}

/**
 * Line path. curve: 'linear' (default) | 'step' | 'smooth'.
 * A lone point renders as a zero-length segment so it stays visible with round caps.
 */
export function linePath(points, { curve = 'linear' } = {}) {
  return segments(points)
    .map((run) =>
      run.length === 1 ? `M${pt(run[0].x, run[0].y)}h0` : runPath(run, curve)
    )
    .join('')
}

/**
 * Closed band between two lines. Points are { x, y, y0 }: y is the top edge,
 * y0 the bottom edge. Used for stacked areas; areaPath() is the y0 = baseline case.
 */
export function bandPath(points, { curve = 'linear' } = {}) {
  const valid = points.map((p) => (isValid(p) && Number.isFinite(p.y0) ? p : null))
  return segments(valid)
    .filter((run) => run.length > 1)
    .map((run) => {
      const bottom = run.map((p) => ({ x: p.x, y: p.y0 }))
      const last = bottom[bottom.length - 1]
      return `${runPath(run, curve)}L${pt(last.x, last.y)}${reversePath(bottom, curve)}Z`
    })
    .join('')
}

/** Closed area path between the line and a horizontal baseline (pixel y). */
export function areaPath(points, baselineY, { curve = 'linear' } = {}) {
  return bandPath(
    points.map((p) => (isValid(p) ? { x: p.x, y: p.y, y0: baselineY } : null)),
    { curve }
  )
}
