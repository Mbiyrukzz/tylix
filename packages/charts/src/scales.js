import { niceTicks } from './ticks.js'

/**
 * Linear scale mapping a numeric domain to a numeric range.
 *
 *   const y = linearScale({ domain: [0, 100], range: [200, 0] })
 *   y(50)        // 100
 *   y.invert(100) // 50
 *   y.ticks(5)   // [0, 20, 40, 60, 80, 100]
 */
export function linearScale({ domain = [0, 1], range = [0, 1], clamp = false } = {}) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0

  const scale = (value) => {
    let t = span === 0 ? 0.5 : (value - d0) / span
    if (clamp) t = Math.min(1, Math.max(0, t))
    return r0 + t * (r1 - r0)
  }

  scale.invert = (px) => {
    const rangeSpan = r1 - r0
    const t = rangeSpan === 0 ? 0 : (px - r0) / rangeSpan
    return d0 + t * span
  }

  scale.domain = () => [d0, d1]
  scale.range = () => [r0, r1]
  scale.ticks = (count = 5) => niceTicks(d0, d1, count)

  return scale
}
