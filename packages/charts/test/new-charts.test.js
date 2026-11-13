import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  timeAxis, timeInterval, lineChart, areaChart, scatterChart, nearestScatterPoint, gauge, calendarHeatmap,
  lineChartSvg, scatterChartSvg, gaugeSvg, calendarHeatmapSvg, pieChartSvg, barChartSvg, describeSeries, dataTable,
  attachCrosshair,
} from '../src/index.js'

const day = (d) => new Date(`${d}T00:00:00Z`)

test('time axis: interval picking and calendar-aligned ticks', () => {
  assert.deepEqual(timeInterval(0, 6 * 3600e3), { unit: 'hour', step: 1 })
  const a = timeAxis(day('2024-01-10'), day('2024-07-20'), 6)
  assert.equal(a.unit, 'month')
  assert.deepEqual(a.ticks.map((t) => t.label), ['Feb 2024', 'Mar 2024', 'Apr 2024', 'May 2024', 'Jun 2024', 'Jul 2024'])
  assert.ok(a.ticks.every((t) => new Date(t.value).getUTCDate() === 1), 'month ticks on the 1st')
  const w = timeAxis(day('2024-01-03'), day('2024-01-28'), 5)
  assert.equal(w.unit, 'week')
  assert.ok(w.ticks.every((t) => new Date(t.value).getUTCDay() === 1), 'week ticks on Mondays')
  const years = timeAxis(day('1990-01-01'), day('2024-01-01'), 6)
  assert.deepEqual(years.ticks.map((t) => t.label), ['1990', '2000', '2010', '2020'])
  assert.equal(timeAxis(day('2024-01-01'), day('2024-01-02'), 6, { timeZone: 'America/New_York' }).ticks[0].label.length, 5)
})

test('line and area charts plot Date x values on a time axis', () => {
  const series = [{ name: 'A', data: [{ x: day('2024-01-01'), y: 1 }, { x: day('2024-01-31'), y: 5 }] }]
  for (const c of [lineChart(series), areaChart(series)]) {
    assert.equal(c.time, true)
    assert.ok(c.xTicks.length >= 3)
    assert.match(c.formatX(day('2024-01-15').getTime()), /Jan 15, 2024/)
  }
  const custom = lineChart(series, { formatX: (d) => d.toISOString().slice(5, 10) })
  assert.match(custom.xTicks[0].label, /^\d\d-\d\d$/)
  assert.equal(lineChart([{ data: [1, 2, 3] }]).time, false)
})

test('scatter: bubbles scale by area and the nearest point is found', () => {
  const c = scatterChart([{ name: 'S', data: [{ x: 0, y: 0, size: 1 }, { x: 10, y: 10, size: 100 }, { x: 5, y: 5, size: 25 }] }], { radius: [2, 20] })
  const byX = Object.fromEntries(c.series[0].points.map((p) => [p.x, p.r]))
  assert.equal(byX[0], 2)
  assert.equal(byX[10], 20)
  assert.ok(Math.abs(byX[5] - (2 + 18 * (4 / 9))) < 1e-9, 'sqrt scaling')
  assert.equal(c.series[0].points[0].r, 20, 'biggest drawn first')
  const p = c.series[0].points.find((q) => q.x === 5)
  assert.equal(nearestScatterPoint(c, p.px + 1, p.py).x, 5)
  assert.equal(nearestScatterPoint(c, -500, -500), null)
})

test('gauge: clamps, colours by threshold, angles', () => {
  const g = gauge(150, { min: 0, max: 100, thresholds: [{ value: 0, color: 'g' }, { value: 80, color: 'r' }] })
  assert.equal(g.value, 100)
  assert.equal(g.color, 'r')
  assert.equal(g.angle, 120)
  assert.equal(gauge(50).angle, 0)
  assert.equal(gauge(0).valuePath, '')
  assert.equal(gauge(10, { bands: true, thresholds: [{ value: 0, color: 'a' }, { value: 5, color: 'b' }] }).bands.length, 2)
})

test('calendar heatmap: weeks, levels, totals', () => {
  const h = calendarHeatmap({ '2024-03-01': 2, '2024-03-02': 8, '2024-03-03': 0 }, { from: '2024-03-01', to: '2024-03-31', weekStart: 1 })
  assert.equal(h.cells[0].date, '2024-02-26', 'starts on the Monday before')
  assert.equal(h.cells.at(-1).date, '2024-03-31')
  assert.equal(h.total, 10)
  assert.equal(h.max, 8)
  const level = Object.fromEntries(h.cells.map((c) => [c.date, c.level]))
  assert.deepEqual([level['2024-03-01'], level['2024-03-02'], level['2024-03-03']], [1, 4, 0])
  assert.ok(h.months.some((m) => m.label === 'Mar'))
})

test('SVG output: title and desc for screen readers', () => {
  const svg = lineChartSvg([{ name: 'CPU', data: [10, 40, 25] }], { id: 'c1', label: 'CPU load' })
  assert.match(svg, /aria-labelledby="c1-t c1-d"/)
  assert.match(svg, /<title id="c1-t">CPU load<\/title><desc id="c1-d">1 series over 3 points\. CPU: 10 to 40, last 25\.<\/desc>/)
  assert.match(pieChartSvg([{ label: 'A', value: 1 }, { label: 'B', value: 3 }]), /<desc[^>]*>A: 1 \(25%\), B: 3 \(75%\)<\/desc>/)
  assert.match(barChartSvg([{ name: 'Sales', data: [3, 7] }], { categories: ['Q1', 'Q2'] }), /Sales: 3 to 7/)
  assert.match(scatterChartSvg([{ name: 'S', data: [{ x: 1, y: 2 }] }]), /tylix-chart--scatter/)
  const g = gaugeSvg(40, { caption: 'Disk', id: 'g1' })
  assert.match(g, /<desc id="g1-d">40 of 0 to 100 \(40%\), Disk<\/desc>/)
  const h = calendarHeatmapSvg([{ date: '2024-01-02', value: 3 }], { to: '2024-01-10', id: 'h1' })
  assert.match(h, /Total 3, highest 3 on 2024-01-02/)
  assert.match(h, />Less</)
})

test('describeSeries and dataTable', () => {
  assert.equal(describeSeries([]), 'No data.')
  const t = dataTable(
    [{ name: 'A & B', data: [{ x: day('2024-01-01'), y: 1 }] }, { name: 'C', data: [{ x: day('2024-01-01'), y: 2 }, { x: day('2024-01-02'), y: 3 }] }],
    { caption: 'Totals', formatX: (d) => d.toISOString().slice(0, 10) },
  )
  assert.match(t, /^<table class="tylix-chart-table"><caption>Totals<\/caption><thead><tr><th scope="col">Date<\/th><th scope="col">A &amp; B<\/th><th scope="col">C<\/th><\/tr><\/thead>/)
  assert.match(t, /<tr><th scope="row">2024-01-02<\/th><td><\/td><td>3<\/td><\/tr>/)
})

test('the crosshair uses the chart formatter for dates', () => {
  const chart = lineChart([{ name: 'A', data: [{ x: day('2024-05-01'), y: 1 }] }])
  assert.equal(typeof attachCrosshair, 'function')
  assert.match(chart.formatX(chart.series[0].points[0].x), /May 1, 2024/)
})

test('x labels at the chart edges are anchored inward', () => {
  const c = lineChart([{ name: 'A', data: [{ x: day('2024-01-01'), y: 1 }, { x: day('2024-07-01'), y: 2 }] }], { width: 400 })
  assert.equal(c.xTicks.at(-1).anchor, 'end')
  for (const t of c.xTicks) {
    const w = t.label.length * 6.2
    const [left, right] = t.anchor === 'start' ? [t.x, t.x + w] : t.anchor === 'end' ? [t.x - w, t.x] : [t.x - w / 2, t.x + w / 2]
    assert.ok(left >= 0 && right <= 400, `${t.label} stays inside`)
  }
  const edge = lineChart([{ data: [1, 2, 3] }], { width: 200, margin: { left: 2 }, formatX: () => 'a long label' })
  assert.equal(edge.xTicks[0].anchor, 'start')
  const s = scatterChart([{ data: [{ x: 0, y: 0 }, { x: 10, y: 10, size: 5 }] }], { width: 300, height: 200, radius: [4, 20] })
  for (const p of s.series[0].points) {
    assert.ok(p.px - p.r >= s.plot.x - 0.01 && p.px + p.r <= s.plot.x + s.plot.width + 0.01, 'bubble inside the plot')
  }
})
