import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DashboardGenerator } from '../generators/DashboardGenerator.js'
import { Blueprint } from '../blueprint/Blueprint.js'
import { renderPageDocument } from '@tylix/compiler'
import { JSDOM } from 'jsdom'

async function loadDocument(html, { window: windowSetup } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/',
  })
  if (windowSetup) windowSetup(dom.window)
  return dom
}

// Polls until conditionFn() is truthy, instead of assuming a fixed
// number of event-loop ticks -- jsdom runs inline <script> execution
// and DOMContentLoaded dispatch through its own async resource queue,
// so a single setTimeout(0) isn't reliably enough time for
// parse -> script queue -> DOMContentLoaded -> onMount's fetch -> render
// to all complete.
async function waitFor(conditionFn, { timeout = 2000, interval = 10 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (conditionFn()) return
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error('waitFor: condition not met within timeout')
}

function makePostBlueprint() {
  const blueprint = new Blueprint('Post')
  blueprint.field('title', 'string').field('body', 'string')
  return blueprint
}

test('generates a dashboard with inline edit/update wiring for each field', () => {
  const blueprint = makePostBlueprint()
  const gen = new DashboardGenerator()
  const source = gen.generateSource(blueprint)

  assert.match(source, /editingId: null/)
  assert.match(source, /edit_title: ""/)
  assert.match(source, /edit_body: ""/)
  assert.match(source, /startEdit\(item\)/)
  assert.match(source, /this\.editingId = item\.id/)
  assert.match(source, /this\.edit_title = item\.title/)
  assert.match(source, /this\.edit_body = item\.body/)
  assert.match(source, /async update\(id\)/)
  assert.match(source, /method: "PUT"/)
  assert.match(source, /\{\{#if item\.id is editingId\}\}/)
  assert.match(source, /\{\{#if item\.id is not editingId\}\}/)
  assert.match(source, /cancelEdit\(\)/)
})

test('mounts the generated dashboard and completes an inline edit/update flow', async () => {
  const blueprint = makePostBlueprint()
  const gen = new DashboardGenerator()
  const source = gen.generateSource(blueprint)
  const html = renderPageDocument(source)

  const fetchCalls = []
  const fakePosts = [{ id: 1, title: 'Original title', body: 'Original body' }]

  const fakeFetch = async (url, options = {}) => {
    fetchCalls.push({ url, options })
    return { json: async () => ({ data: fakePosts }) }
  }

  const dom = await loadDocument(html, {
    window: (window) => {
      window.fetch = fakeFetch
    },
  })
  const document = dom.window.document

  // Wait for the initial mount (form + empty list) to actually land in #app.
  await waitFor(
    () => (document.getElementById('app')?.children.length ?? 0) > 0,
  )

  // Wait for onMount's fetch to resolve and the row to render.
  await waitFor(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Edit',
    ),
  )

  const editButton = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Edit',
  )
  assert.ok(editButton, 'expected an Edit button to render for the seeded row')

  editButton.click()

  await waitFor(() => {
    const inputs = [...document.querySelectorAll('input')]
    return inputs.some(
      (i) => i.placeholder === 'title' && i.value === 'Original title',
    )
  })

  const titleEditInput = [...document.querySelectorAll('input')].find(
    (i) => i.placeholder === 'title' && i.value === 'Original title',
  )
  assert.ok(
    titleEditInput,
    "expected the edit-row title input to be pre-filled with the item's current value",
  )

  titleEditInput.value = 'Updated title'
  titleEditInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

  await waitFor(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Save',
    ),
  )

  const saveButton = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Save',
  )
  assert.ok(saveButton, 'expected a Save button while editing')

  saveButton.click()

  await waitFor(() => fetchCalls.some((c) => c.options.method === 'PUT'))

  const putCall = fetchCalls.find((c) => c.options.method === 'PUT')
  assert.ok(putCall, 'expected update() to issue a PUT request')
  assert.equal(putCall.url, '/api/posts/1')

  const body = JSON.parse(putCall.options.body)
  assert.equal(body.title, 'Updated title')
  assert.equal(body.body, 'Original body')
})
