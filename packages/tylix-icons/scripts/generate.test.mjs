import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { compile } from 'svelte/compiler'
import * as react from '../react/index.js'
import * as vue from '../vue/index.js'
import { icons } from '../data/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(fs.readFileSync(path.join(root, 'src/icons.json'), 'utf-8'))
const names = Object.keys(source).map((name) => `Icon${name}`)

test('every format has every icon, and the output is up to date', () => {
  assert.ok(names.length >= 500)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tylix-components.json'), 'utf-8'))
  const angular = fs.readFileSync(path.join(root, 'angular/fesm2022/index.mjs'), 'utf-8')
  const svelte = fs.readFileSync(path.join(root, 'svelte/index.js'), 'utf-8')
  for (const name of names) {
    assert.equal(typeof react[name], 'object', `react ${name}`)
    assert.equal(typeof vue[name], 'function', `vue ${name}`)
    assert.ok(manifest[name], `tyx ${name}`)
    assert.ok(svelte.includes(`as ${name} }`), `svelte ${name}`)
    assert.ok(angular.includes(`{ ${name} }`), `angular ${name}`)
  }
  assert.equal(Object.keys(icons).length, names.length, 'data (run npm run generate after editing src/icons.json)')
})

test('icon markup only uses the shapes the generator supports', () => {
  for (const [name, markup] of Object.entries(source)) {
    assert.match(markup, /^(<(path|circle|rect|ellipse)( [a-z-]+='[^']*')+\/>)+$/, name)
  }
})

test('React: decorative by default, titled icons are images, props reach the svg', () => {
  const plain = renderToStaticMarkup(createElement(react.IconBell))
  assert.match(plain, /^<svg[^>]*width="20"[^>]*aria-hidden="true"[^>]*><path d="M6 10a6/)
  assert.match(plain, /stroke-linecap="round"/)
  const titled = renderToStaticMarkup(createElement(react.IconBell, { title: 'Alerts', size: 16, className: 'text-rose-500' }))
  assert.match(titled, /role="img"/)
  assert.match(titled, /class="text-rose-500"/)
  assert.match(titled, /width="16"/)
  assert.match(titled, /<title>Alerts<\/title>/)
  assert.doesNotMatch(titled, /aria-hidden/)
})

test('Vue: renders on the server with fallthrough attributes', async () => {
  const html = await renderToString(createSSRApp({ render: () => h(vue.IconBell, { class: 'w-4', size: 18, title: 'Alerts' }) }))
  assert.match(html, /^<svg[^>]*class="w-4"/)
  assert.match(html, /width="18"/)
  assert.match(html, /role="img"/)
  assert.match(html, /<title>Alerts<\/title><path d="M6 10a6/)
})

test('Svelte: every component compiles', () => {
  const dir = path.join(root, 'svelte')
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
    const { js } = compile(fs.readFileSync(path.join(dir, file), 'utf-8'), { filename: file, generate: 'server' })
    assert.ok(js.code.includes('<svg'), file)
  }
})

test('one module per Angular and Svelte icon, pure calls for React and Vue (tree-shaking)', () => {
  assert.equal(fs.readdirSync(path.join(root, 'angular/fesm2022')).filter((f) => /^Icon.*\.mjs$/.test(f)).length, names.length)
  const reactSource = fs.readFileSync(path.join(root, 'react/index.js'), 'utf-8')
  assert.equal(reactSource.match(/\/\* @__PURE__ \*\//g).length, names.length)
})
