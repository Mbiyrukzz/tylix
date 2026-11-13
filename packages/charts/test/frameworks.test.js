// The React, Vue and Svelte wrappers: server rendering, and (React)
// hydration in jsdom with the crosshair attached.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const series = [{ name: 'CPU', data: [10, 40, 25, 60] }]

test('React: server render, then hydrate with the same ids and a crosshair', async () => {
  const { createElement } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { LineChart, Gauge, Chart } = await import('../src/frameworks/react.js')

  const app = () => createElement('main', null, createElement(LineChart, { series, height: 200, label: 'CPU' }), createElement(Gauge, { value: 40, caption: 'Disk' }), createElement(Chart, { type: 'heatmap', data: [{ date: '2024-01-02', value: 1 }], to: '2024-01-31' }))
  const html = renderToString(app())
  assert.match(html, /class="tylix-chart-host"/)
  assert.match(html, /<title id="tc[^"]*-t">CPU<\/title>/)
  assert.match(html, /tylix-chart--gauge/)
  assert.match(html, /tylix-chart--heatmap/)
  assert.doesNotMatch(html, /class="tc-pt"/, 'static point tooltips are replaced by the crosshair')

  const dom = new JSDOM(`<!doctype html><div id="root">${html}</div>`, { pretendToBeVisual: true })
  const saved = {}
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    saved[k] = globalThis[k]
    Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true })
  }
  const errors = []
  const origError = console.error
  console.error = (...a) => errors.push(a.join(' '))
  try {
    const { hydrateRoot } = await import('react-dom/client')
    const { act } = await import('react')
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => {
      hydrateRoot(dom.window.document.getElementById('root'), app())
    })
    assert.deepEqual(errors, [], 'no hydration warnings')
    assert.ok(dom.window.document.querySelector('.tylix-crosshair'), 'crosshair attached to the line chart')
  } finally {
    console.error = origError
    for (const [k, v] of Object.entries(saved)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }
})

test('Vue: server render', async () => {
  const { createSSRApp, h } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { BarChart, Chart } = await import('../src/frameworks/vue.js')
  const app = createSSRApp({
    render: () => h('div', [
      h(BarChart, { series: [{ name: 'Sales', data: [3, 7] }], categories: ['Q1', 'Q2'], class: 'mine' }),
      h(Chart, { type: 'pie', data: [{ label: 'A', value: 1 }] }),
    ]),
  })
  const html = await renderToString(app)
  assert.match(html, /class="tylix-chart-host mine"/)
  assert.match(html, /tylix-chart--bar/)
  assert.match(html, /Q1/)
  assert.match(html, /tylix-chart--pie/)
})

test('Svelte: server render', async () => {
  const { compile } = await import('svelte/compiler')
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/frameworks/svelte')
  const source = fs.readFileSync(path.join(dir, 'Chart.svelte'), 'utf8')
  const { js } = compile(source, { generate: 'server', filename: 'Chart.svelte' })
  const out = path.join(dir, `.Chart.server.${process.pid}.js`)
  fs.writeFileSync(out, js.code)
  try {
    const { default: Chart } = await import(pathToFileURL(out).href)
    const { render } = await import('svelte/server')
    const { body } = render(Chart, { props: { type: 'scatter', series: [{ name: 'S', data: [{ x: 1, y: 2 }] }], class: 'x' } })
    assert.match(body, /class="tylix-chart-host x"/)
    assert.match(body, /tylix-chart--scatter/)
  } finally {
    fs.rmSync(out, { force: true })
  }
})

test('unknown chart types are a clear error', async () => {
  const { renderChart } = await import('../src/index.js')
  assert.throws(() => renderChart('radar', []), /Unknown chart type "radar"/)
})
