import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bandScale, linePath, areaPath, bandPath, lineChartSvg, sparklineSvg,
  areaChart, areaChartSvg, barChart, barChartSvg, roundedBarPath,
  pieChart, donutChart, pieChartSvg, donutChartSvg, arcPath,
} from '../src/index.js'

const wellFormed = (s) => s.startsWith('<svg') && s.endsWith('</svg>')
const noNaN = (s) => assert.ok(!/NaN|undefined|Infinity/.test(s), 'svg contains NaN/undefined')

// ---- regression: existing path behaviour
test('linePath / areaPath keep their original output', () => {
  assert.equal(linePath([{ x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 3, y: 3 }, { x: 4, y: 4 }]), 'M0,0L1,1M3,3L4,4')
  assert.equal(linePath([{ x: 0, y: 0 }, { x: 2, y: 4 }], { curve: 'step' }), 'M0,0H2V4')
  assert.equal(linePath([{ x: 1, y: 1 }]), 'M1,1h0')
  assert.equal(areaPath([{ x: 0, y: 0 }, { x: 10, y: 5 }], 20), 'M0,0L10,5L10,20L0,20Z')
})

test('smooth curves emit cubics and fall back when x is not increasing', () => {
  const pts = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 5 }, { x: 30, y: 5 }]
  assert.ok(linePath(pts, { curve: 'smooth' }).includes('C'))
  assert.ok(!linePath([{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 6 }], { curve: 'smooth' }).includes('C'))
  assert.ok(areaPath(pts, 20, { curve: 'smooth' }).endsWith('Z'))
})

test('smooth curve never overshoots the data range (monotone)', () => {
  const pts = [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 0 }]
  const d = linePath(pts, { curve: 'smooth' })
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number)
  for (let i = 1; i < nums.length; i += 2) assert.ok(nums[i] >= -0.01 && nums[i] <= 10.01)
})

test('bandPath draws a band between two edges and splits on gaps', () => {
  const d = bandPath([{ x: 0, y: 0, y0: 10 }, { x: 5, y: 2, y0: 10 }, null, { x: 9, y: 1, y0: 8 }, { x: 10, y: 1, y0: 8 }])
  assert.equal(d.split('M').length - 1, 2)
  assert.equal(
    bandPath([{ x: 0, y: 0, y0: 10 }, { x: 5, y: 2, y0: 10 }], { curve: 'step' }),
    'M0,0H5V2L5,10V10H0Z'
  )
})

// ---- band scale
test('bandScale lays out equal bands inside the range', () => {
  const s = bandScale({ domain: ['a', 'b', 'c'], range: [0, 300], padding: 0 })
  assert.equal(s('a'), 0)
  assert.equal(s('b'), 100)
  assert.equal(s.bandwidth(), 100)
  assert.equal(s.center('c'), 250)
  assert.equal(s('zzz'), undefined)
  const p = bandScale({ domain: [0, 1], range: [0, 100], padding: 0.2 })
  assert.ok(p(0) > 0 && p(1) + p.bandwidth() < 100)
})

// ---- bars
test('roundedBarPath rounds only the outer end', () => {
  assert.equal(roundedBarPath(0, 0, 10, 10, 4, 'none'), 'M0,0H10V10H0Z')
  assert.ok(roundedBarPath(0, 0, 10, 10, 4, 'top').includes('A4,4'))
  assert.equal(roundedBarPath(0, 0, 0, 10, 4, 'top'), '')
  for (const side of ['top', 'bottom', 'left', 'right']) {
    assert.ok(roundedBarPath(0, 0, 20, 30, 50, side).includes('A10,10') || roundedBarPath(0, 0, 20, 30, 50, side).includes('A15,15'))
  }
})

test('barChart: grouped vertical bars sit on the baseline and fit the plot', () => {
  const c = barChart(
    [{ name: 'A', data: [10, 20, 30] }, { name: 'B', data: [5, null, 15] }],
    { categories: ['x', 'y', 'z'], width: 400, height: 200 }
  )
  assert.equal(c.categoryTicks.length, 3)
  assert.equal(c.series[1].bars[1].path, '')
  const b = c.series[0].bars[2]
  assert.ok(Math.abs(b.y + b.height - c.baseline) < 0.01)
  for (const s of c.series) for (const bar of s.bars) {
    if (!bar.path) continue
    assert.ok(bar.x >= c.plot.x - 0.01 && bar.x + bar.width <= c.plot.x + c.plot.width + 0.01)
  }
  // grouped bars in one category must not overlap
  const [a, bb] = [c.series[0].bars[0], c.series[1].bars[0]]
  assert.ok(a.x + a.width <= bb.x + 0.01)
})

test('barChart: stacked segments touch, only the outer one is rounded', () => {
  const c = barChart(
    [{ name: 'A', data: [10, 5] }, { name: 'B', data: [20, 5] }],
    { stacked: true, radius: 6 }
  )
  const a = c.series[0].bars[0]
  const b = c.series[1].bars[0]
  assert.ok(Math.abs(b.y + b.height - a.y) < 0.01) // B sits on top of A
  assert.ok(!a.path.includes('A')) // lower segment: square
  assert.ok(b.path.includes('A')) // top segment: rounded
})

test('barChart: negatives, horizontal layout, empty input', () => {
  const neg = barChart([{ data: [-5, 10] }])
  assert.ok(neg.valueScale.domain()[0] < 0)
  assert.ok(neg.series[0].bars[0].y >= neg.baseline - 0.01)
  const h = barChart([{ data: [3, 6] }], { categories: ['aa', 'bb'], orientation: 'horizontal' })
  assert.equal(h.orientation, 'horizontal')
  assert.ok(h.plot.x >= 40)
  assert.ok(h.series[0].bars[1].width > h.series[0].bars[0].width)
  assert.deepEqual(barChart([]).series, [])
})

// ---- area
test('areaChart: stacked layers share edges; values default to a zero baseline', () => {
  const c = areaChart(
    [{ name: 'A', data: [1, 2, 3] }, { name: 'B', data: [3, null, 1] }],
    { stacked: true }
  )
  assert.equal(c.series[1].points[0].py0, c.series[0].points[0].py)
  assert.equal(c.series[1].points[1].value, null)
  assert.notEqual(c.series[1].points[1].py, null) // null counts as 0 when stacked
  assert.ok(c.yScale.domain()[0] <= 0)
  const flat = areaChart([{ data: [4, null, 6] }])
  assert.equal(flat.series[0].points[1].py, null)
  assert.equal((flat.series[0].areaPath.match(/M/g) || []).length, 0) // lone points leave no area
})

// ---- pie / donut
test('pieChart: angles add up to a full turn and percentages to 1', () => {
  const g = pieChart([{ label: 'a', value: 1 }, { label: 'b', value: 3 }, { label: 'c', value: 0 }, 4])
  assert.equal(g.total, 8)
  assert.equal(g.slices[2].path, '')
  const sum = g.slices.reduce((s, x) => s + x.percent, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
  assert.ok(Math.abs(g.slices.at(-1).endAngle - Math.PI * 2) < 1e-9)
  assert.equal(g.slices[1].percentLabel, '38%')
})

test('pieChart: sort, tiny slices, empty and single-slice data', () => {
  const d = pieChart([1, 5, 3], { sort: 'desc' })
  assert.deepEqual(d.slices.map((s) => s.value), [5, 3, 1])
  assert.equal(pieChart([1, 999]).slices[0].percentLabel, '<1%')
  assert.equal(pieChart([]).total, 0)
  const one = donutChart([{ label: 'x', value: 5 }])
  assert.ok(one.slices[0].path.split('M').length - 1 === 2) // outer + inner ring
  assert.ok(one.innerRadius > 0)
})

test('arcPath handles corners, tiny angles and rejects empty spans', () => {
  assert.equal(arcPath({ outerRadius: 10, startAngle: 1, endAngle: 1 }), '')
  const d = arcPath({ outerRadius: 50, innerRadius: 30, startAngle: 0, endAngle: 1, cornerRadius: 6 })
  assert.ok(d.startsWith('M') && d.endsWith('Z'))
  noNaN(d)
  noNaN(arcPath({ outerRadius: 50, innerRadius: 30, startAngle: 0, endAngle: 0.01, cornerRadius: 20 }))
  noNaN(arcPath({ outerRadius: 50, startAngle: 0, endAngle: 5, cornerRadius: 20 }))
  assert.ok(!arcPath({ outerRadius: 50, startAngle: 0, endAngle: 1, cornerRadius: 0 }).includes('NaN'))
})

// ---- svg strings
test('svg renderers are well-formed, escaped and NaN-free', () => {
  const s1 = [{ name: 'A <1>', data: [1, 4, 2, 8] }, { name: 'B', data: [2, 3, 5, 4] }]
  const outputs = [
    lineChartSvg(s1, { label: 'x & y', curve: 'smooth', area: true }),
    areaChartSvg(s1, { stacked: true }),
    barChartSvg(s1, { categories: ['q1', 'q2', 'q3', 'q4'], valueLabels: true }),
    barChartSvg(s1, { orientation: 'horizontal', stacked: true, categories: ['a', 'b', 'c', 'd'] }),
    pieChartSvg([{ label: 'One', value: 2 }, { label: 'Two <b>', value: 5 }]),
    donutChartSvg([{ label: 'One', value: 2 }, { label: 'Two', value: 5 }], { legend: 'bottom' }),
    donutChartSvg([]),
    barChartSvg([]),
    areaChartSvg([]),
  ]
  for (const o of outputs) {
    assert.ok(wellFormed(o))
    noNaN(o)
  }
  assert.ok(outputs[0].includes('x &amp; y'))
  assert.ok(outputs[0].includes('A &lt;1&gt;'))
  assert.ok(outputs[1].includes('<path'))
  assert.ok(outputs[4].includes('Two &lt;b&gt;'))
  assert.ok(outputs[5].includes('Total'))
})

test('legend appears for 2+ series, not for one; ids are unique unless set', () => {
  const one = lineChartSvg([{ data: [1, 2] }])
  const two = lineChartSvg([{ data: [1, 2] }, { data: [2, 3] }])
  assert.ok(!one.includes('<rect'))
  assert.ok(two.includes('<rect'))
  assert.ok(!lineChartSvg([{ data: [1] }, { data: [2] }], { legend: false }).includes('<rect'))
  const id = (s) => s.match(/class="tylix-chart [^"]*? (tc\d+)"/)?.[1]
  assert.notEqual(id(one), id(two))
  assert.ok(lineChartSvg([{ data: [1] }], { id: 'fixed' }).includes('class="tylix-chart tylix-chart--line fixed"'))
  assert.ok(sparklineSvg([1, 2, 3]).startsWith('<svg'))
})

// ---- crosshair (pure part)
import { lineChart, nearestPoints, snapPositions } from '../src/index.js'

test('nearestPoints snaps to the closest x and lists every series there', () => {
  const c = lineChart([{ name: 'A', data: [1, 2, 3, 4] }, { name: 'B', data: [4, null, 2, 1] }], { width: 400 })
  const xs = snapPositions(c)
  assert.equal(xs.length, 4)
  const n = nearestPoints(c, xs[1] + 3)
  assert.equal(n.index, 1)
  assert.equal(n.x, 1)
  assert.deepEqual(n.rows.map((r) => r.name), ['A']) // B has a gap here
  assert.equal(nearestPoints(c, -999).index, 0)
  assert.equal(nearestPoints(c, 9999).index, 3)
  assert.equal(nearestPoints(lineChart([]), 10), null)
})
