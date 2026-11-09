/**
 * Band scale: maps discrete values to evenly spaced bands (for bar charts).
 *
 *   const x = bandScale({ domain: ['a', 'b', 'c'], range: [0, 300] })
 *   x('b')           // start of the band
 *   x.bandwidth()    // width of one band
 *   x.center('b')    // middle of the band
 */
export function bandScale({
  domain = [],
  range = [0, 1],
  padding = 0.2,
  paddingInner = padding,
  paddingOuter = padding / 2,
} = {}) {
  const [r0, r1] = range
  const n = domain.length
  const span = r1 - r0
  const step = n === 0 ? 0 : span / Math.max(1, n - paddingInner + paddingOuter * 2)
  const bandwidth = step * (1 - paddingInner)
  const start = r0 + (span - step * (n - paddingInner)) / 2
  const index = new Map(domain.map((v, i) => [v, i]))

  const scale = (value) => {
    const i = index.get(value)
    return i === undefined ? undefined : start + step * i
  }
  scale.bandwidth = () => bandwidth
  scale.step = () => step
  scale.center = (value) => {
    const s = scale(value)
    return s === undefined ? undefined : s + bandwidth / 2
  }
  scale.domain = () => domain.slice()
  scale.range = () => [r0, r1]
  return scale
}
