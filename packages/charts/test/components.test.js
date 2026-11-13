// The .tyx components, compiled by @tylix/compiler and run in jsdom.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import { renderPageDocument } from '@tylix/compiler'
import * as charts from '../src/index.js'

const component = (name) => fs.readFileSync(new URL(`../components/${name}.tyx`, import.meta.url), 'utf8')

async function mount(template, used, state = '') {
  const source = `page Demo\n\n${state}\ntemplate\n  <div>${template}</div>\n`
  const components = Object.fromEntries(used.map((n) => [n, component(n)]))
  const html = await renderPageDocument(source, components)
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost',
    pretendToBeVisual: true,
    beforeParse(window) {
      // what onMount would import from /_tylix/charts/index.js
      window.__tylixCharts = charts
      window.__tylixChartsLoad = Promise.resolve()
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    },
  })
  await new Promise((r) => dom.window.document.addEventListener('DOMContentLoaded', r))
  await new Promise((r) => setTimeout(r, 20))
  const { window } = dom
  const svg = (i = 0) => window.document.querySelectorAll('#app svg')[i]
  const size = (el, w, h) => (el.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h }))
  return { window, svg, size }
}

test('ScatterChart renders points and a tooltip for the nearest one', async () => {
  const { window, svg, size } = await mount(
    '<ScatterChart label="Plans" series="{{ series }}" width="{{ 400 }}" height="{{ 200 }}" />',
    ['ScatterChart'],
    'state\n  series: [{ name: "A", data: [{ x: 1, y: 2, label: "first" }, { x: 5, y: 9, size: 30 }] }, { name: "B", data: [{ x: 3, y: 4 }] }]\n',
  )
  const s = svg()
  assert.equal(s.querySelectorAll('circle').length, 3)
  const target = [...s.querySelectorAll('circle')].find((c) => c.getAttribute('fill-opacity') === '0.85')
  size(s, 400, 200)
  const ev = new window.MouseEvent('pointermove', { clientX: Number(target.getAttribute('cx')), clientY: Number(target.getAttribute('cy')) })
  s.dispatchEvent(ev)
  assert.match(s.textContent, /first|B/)
  assert.ok(window.document.querySelector('#app table'), 'screen-reader table')
  assert.ok(window.document.querySelector('#app').textContent.includes('A'), 'legend for 2 series')
})

test('Gauge exposes a meter role with its value', async () => {
  const { svg } = await mount('<Gauge value="{{ 72 }}" caption="CPU" needle="{{ true }}" thresholds="{{ [{ value: 0, color: \'green\' }, { value: 60, color: \'orange\' }] }}" />', ['Gauge'])
  const s = svg()
  assert.equal(s.getAttribute('role'), 'meter')
  assert.equal(s.getAttribute('aria-valuenow'), '72')
  assert.match(s.getAttribute('aria-label'), /Gauge: 72 of 0 to 100, CPU/)
  assert.ok([...s.querySelectorAll('path')].some((p) => p.getAttribute('fill') === 'orange'), 'value arc takes the threshold colour')
})

test('Heatmap renders a year of days with a tooltip and keyboard movement', async () => {
  const { window, svg } = await mount(
    '<Heatmap data="{{ days }}" to="2024-12-31" label="Commits" />',
    ['Heatmap'],
    'state\n  days: [{ date: "2024-12-30", value: 4 }, { date: "2024-12-31", value: 1 }]\n',
  )
  const s = svg()
  const cells = [...s.querySelectorAll('rect[onpointerenter], rect')].filter((r) => r.getAttribute('width') === '11')
  assert.ok(cells.length >= 365)
  s.dispatchEvent(new window.FocusEvent('focus'))
  assert.match(s.textContent, /1 on 2024-12-31/)
  s.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }))
  assert.match(s.textContent, /4 on 2024-12-30/)
  assert.match(s.getAttribute('aria-label'), /Commits: \d+ days, total 5/)
})

test('LineChart shows dates on a time axis and has a data table', async () => {
  const { window, svg } = await mount(
    '<LineChart label="Visits" series="{{ series }}" />',
    ['LineChart'],
    'state\n  series: [{ name: "Visits", data: [{ x: new Date("2024-01-01"), y: 3 }, { x: new Date("2024-03-01"), y: 9 }] }]\n',
  )
  assert.match(svg().textContent, /Jan|Feb|Mar/)
  const table = window.document.querySelector('#app table')
  assert.equal(table.querySelector('caption').textContent, 'Visits')
  assert.match(table.textContent, /Jan 1, 2024/)
})
