import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  linearScale,
  niceTicks,
  extent,
  linePath,
  areaPath,
  sparkline,
  sparklineSvg,
  lineChart,
  lineChartSvg,
} from '../src/index.js'

test('niceTicks covers the range with round steps', () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100])
  const t = niceTicks(3, 97, 5)
  assert.ok(t[0] <= 3 && t[t.length - 1] >= 97)
  assert.deepEqual(niceTicks(5, 5), [5])
  assert.deepEqual(niceTicks(NaN, 1), [])
})

test('extent ignores non-finite values', () => {
  assert.deepEqual(extent([3, null, 1, NaN, 7]), [1, 7])
  assert.equal(extent([null, undefined]), null)
})

test('linearScale maps and inverts', () => {
  const y = linearScale({ domain: [0, 100], range: [200, 0] })
  assert.equal(y(0), 200)
  assert.equal(y(50), 100)
  assert.equal(y.invert(100), 50)
  assert.deepEqual(y.ticks(5), [0, 20, 40, 60, 80, 100])
})

test('linearScale handles a zero-width domain and clamping', () => {
  const flat = linearScale({ domain: [5, 5], range: [0, 10] })
  assert.equal(flat(5), 5)
  const c = linearScale({ domain: [0, 10], range: [0, 100], clamp: true })
  assert.equal(c(20), 100)
  assert.equal(c(-5), 0)
})

test('linePath breaks on gaps', () => {
  const d = linePath([{ x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 3, y: 3 }, { x: 4, y: 4 }])
  assert.equal(d, 'M0,0L1,1M3,3L4,4')
})

test('linePath supports step curves and lone points', () => {
  assert.equal(linePath([{ x: 0, y: 0 }, { x: 2, y: 4 }], { curve: 'step' }), 'M0,0H2V4')
  assert.equal(linePath([{ x: 1, y: 1 }]), 'M1,1h0')
})

test('areaPath closes to the baseline', () => {
  const d = areaPath([{ x: 0, y: 0 }, { x: 10, y: 5 }], 20)
  assert.equal(d, 'M0,0L10,5L10,20L0,20Z')
})

test('sparkline returns geometry and the last point', () => {
  const s = sparkline([1, 2, 3, 2, 5], { width: 100, height: 20, padding: 2 })
  assert.equal(s.min, 1)
  assert.equal(s.max, 5)
  assert.equal(s.last.value, 5)
  assert.equal(s.last.x, 98)
  assert.ok(s.path.startsWith('M'))
  assert.ok(s.areaPath.endsWith('Z'))
})

test('sparkline handles empty, all-null and flat data', () => {
  assert.equal(sparkline([]).path, '')
  assert.equal(sparkline([null, null]).last, null)
  const flat = sparkline([4, 4, 4], { height: 20, padding: 2 })
  assert.ok(flat.path.length > 0)
  assert.equal(flat.last.y, 10) // vertically centered
})

test('lineChart builds ticks, plot area and series paths', () => {
  const c = lineChart(
    [{ name: 'CPU', data: [10, 40, 30, 80] }],
    { width: 300, height: 200, formatY: (v) => `${v}%` }
  )
  assert.equal(c.plot.x, 40)
  assert.equal(c.plot.width, 300 - 40 - 12)
  assert.ok(c.yTicks.length >= 2)
  assert.ok(c.yTicks[0].label.endsWith('%'))
  assert.equal(c.series.length, 1)
  assert.equal(c.series[0].points.length, 4)
  assert.ok(c.series[0].path.startsWith('M'))
  assert.equal(c.series[0].areaPath, '')
})

test('lineChart supports {x,y} data, gaps, area and multiple series', () => {
  const c = lineChart(
    [
      { name: 'A', data: [{ x: 1000, y: 1 }, { x: 2000, y: null }, { x: 3000, y: 3 }] },
      { name: 'B', data: [2, 3, 4] },
    ],
    { area: true, zeroBaseline: true }
  )
  assert.equal(c.series[0].points[1].py, null)
  assert.equal(c.series[0].path.split('M').length - 1, 2) // two segments
  assert.notEqual(c.series[1].color, c.series[0].color)
})

test('lineChart tolerates empty input', () => {
  const c = lineChart([])
  assert.deepEqual(c.series, [])
  assert.ok(c.yTicks.length >= 1)
})

test('svg renderers produce escaped, well-formed strings', () => {
  const sp = sparklineSvg([1, 3, 2], { label: 'CPU <5m>' })
  assert.ok(sp.startsWith('<svg') && sp.endsWith('</svg>'))
  assert.ok(sp.includes('CPU &lt;5m&gt;'))

  const lc = lineChartSvg([{ name: 'CPU', data: [1, 2, 3] }], { label: 'CPU' })
  assert.ok(lc.startsWith('<svg') && lc.endsWith('</svg>'))
  assert.ok(lc.includes('<path'))
})
