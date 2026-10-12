// Nice-number tick generation (Heckbert's algorithm).

function niceNumber(range, round) {
  const exp = Math.floor(Math.log10(range))
  const f = range / Math.pow(10, exp)
  let nf
  if (round) {
    nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  } else {
    nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  }
  return nf * Math.pow(10, exp)
}

/**
 * Returns evenly spaced "nice" tick values covering [min, max].
 * The first tick is <= min and the last tick is >= max.
 */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  if (min > max) [min, max] = [max, min]

  const range = niceNumber(max - min, false)
  const step = niceNumber(range / (Math.max(count, 2) - 1), true)
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step))))

  const ticks = []
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toFixed(decimals)))
  }
  return ticks
}

/** Returns [min, max] of the finite numbers in `values`, or null if none. */
export function extent(values) {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return min === Infinity ? null : [min, max]
}
