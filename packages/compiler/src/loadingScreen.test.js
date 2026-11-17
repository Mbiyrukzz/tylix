import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { renderPageDocument } from './renderPageDocument.js'
import { loadingScreenHtml } from './loadingScreen.js'

async function render(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-loading-screen-'))
  try {
    return await renderPageDocument('page Home\n\ntemplate\n<h1>Hello</h1>\n', {}, {
      capabilitiesDir: dir,
      headFile: path.join(dir, 'x'),
      shellFile: path.join(dir, 'x'),
      loadingFile: path.join(dir, 'x'),
      stylesheets: [],
      ...options,
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test('a native page shows the loading screen until it renders, then removes it', async () => {
  const html = await render()
  assert.match(html, /<div id="tylix-loading-screen" role="status"/)
  assert.ok(html.indexOf('tylix-loading-screen') < html.indexOf('<div id="app">'))
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false })
    },
  })
  await new Promise((r) => setTimeout(r, 500))
  const doc = dom.window.document
  assert.equal(doc.querySelector('h1')?.textContent, 'Hello')
  assert.equal(doc.getElementById('tylix-loading-screen'), null)
})

test('loadingScreen: false leaves it out', async () => {
  assert.doesNotMatch(await render({ loadingScreen: false }), /tylix-loading-screen/)
})

test('the screen waits for any of the listed roots', async () => {
  const dom = new JSDOM(`<!doctype html><body>${loadingScreenHtml({ root: '#root, app-root' })}<app-root></app-root></body>`, {
    runScripts: 'dangerously',
  })
  const doc = dom.window.document
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(doc.getElementById('tylix-loading-screen'), 'still up while app-root is empty')
  doc.querySelector('app-root').appendChild(doc.createElement('main'))
  await new Promise((r) => setTimeout(r, 450))
  assert.equal(doc.getElementById('tylix-loading-screen'), null)
})
