import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseTyx } from '@tylix/compiler'
import {
  completions,
  contextAt,
  definition,
  documentSymbols,
  hover,
  offsetAt,
  positionAt,
  wordAt,
} from './analysis.js'

const PAGE = `page Posts

import Card from "./components/Card"

props
  limit?: number

state
  items(string[]): []
  query: ""

computed
  filtered() {
    return this.items.filter(i => i.includes(this.query))
  }

action
  async load(page: number) {
    this.items = []
  }

template
  <div>
    {{#each item in filtered}}
      <Card title="{{ item }}" />
    {{/each}}
    <p>{{ query }}</p>
  </div>
`

const CAPABILITY = `capability Auth

state
  user: null

action
  async logout() {
    this.user = null
  }
`

function docFor(text) {
  const r = diagnoseTyx(text)
  return { text, kind: r.kind, symbols: r.symbols, imports: r.imports }
}

const project = {
  capabilities: new Map([
    ['Auth', { file: '/app/capabilities/Auth.tyx', text: CAPABILITY, symbols: diagnoseTyx(CAPABILITY).symbols }],
  ]),
  resolveImport: (s) => (s === './components/Card' ? '/app/pages/components/Card.tyx' : null),
}

// Position of the first `marker` in text (cursor placed after it).
function after(text, marker, nth = 0) {
  let i = -1
  for (let n = 0; n <= nth; n++) i = text.indexOf(marker, i + 1)
  assert.ok(i > -1, `marker ${marker} not found`)
  return positionAt(text, i + marker.length)
}

const labels = (items) => items.map((i) => i.label)

test('offsetAt / positionAt round-trip', () => {
  const p = { line: 2, character: 3 }
  assert.deepEqual(positionAt(PAGE, offsetAt(PAGE, p)), p)
})

test('wordAt finds the qualifier', () => {
  const text = 'x = this.items + Auth.user'
  assert.deepEqual(wordAt(text, text.indexOf('items') + 2), {
    word: 'items', start: 9, end: 14, qualifier: 'this',
  })
  assert.equal(wordAt(text, text.length).qualifier, 'Auth')
})

test('contextAt knows the section and {{ }}', () => {
  assert.equal(contextAt(PAGE, offsetAt(PAGE, after(PAGE, 'this.items'))).section, 'script')
  const inExpr = contextAt(PAGE, offsetAt(PAGE, after(PAGE, '{{ que')))
  assert.equal(inExpr.section, 'template')
  assert.equal(inExpr.inExpression, true)
  assert.equal(contextAt(PAGE, offsetAt(PAGE, after(PAGE, '<p>'))).inExpression, false)
})

test('completes members after this.', () => {
  const text = PAGE.replace('this.items = []', 'this.')
  const items = completions({ ...docFor(PAGE), text }, after(text, 'this.', 2), project)
  assert.deepEqual(labels(items).sort(), ['filtered', 'items', 'limit', 'load', 'query'])
})

test('completes members, loop variables and capabilities inside {{ }}', () => {
  const doc = docFor(PAGE)
  const got = labels(completions(doc, after(PAGE, '{{ '), project))
  for (const name of ['items', 'query', 'filtered', 'load', 'Auth', 'and', 'is', '$event']) {
    assert.ok(got.includes(name), `missing ${name}`)
  }
  const inLoop = labels(completions(doc, after(PAGE, 'title="{{ '), project))
  assert.ok(inLoop.includes('item'))
})

test('completes capability members after Name.', () => {
  const text = PAGE.replace('{{ query }}', '{{ Auth. }}')
  const got = labels(completions({ ...docFor(PAGE), text }, after(text, 'Auth.'), project))
  assert.deepEqual(got.sort(), ['logout', 'user'])
})

test('completes section keywords at the start of a line', () => {
  const text = PAGE.replace('\nstate\n', '\nst\n')
  const got = labels(completions({ ...docFor(PAGE), text }, after(text, '\nst'), project))
  assert.ok(got.includes('state') && got.includes('onMount') && got.includes('template'))
  assert.ok(!got.includes('init'), 'init is for capabilities')
})

test('completes imported components after <', () => {
  const text = PAGE.replace('<p>{{ query }}</p>', '<')
  const got = labels(completions({ ...docFor(PAGE), text }, after(text, '    <', 1), project))
  assert.deepEqual(got, ['Card'])
})

test('nothing is completed in style', () => {
  const text = `${PAGE}\nstyle\n  p { color: red }\n`
  assert.deepEqual(completions({ ...docFor(text), text }, after(text, 'color'), project), [])
})

test('hover shows the symbol and keyword docs', () => {
  const doc = docFor(PAGE)
  const h = hover(doc, after(PAGE, 'this.ite'), project)
  assert.match(h.contents.value, /\(state\) items: string\[\]/)
  const k = hover({ ...doc, text: PAGE.replace('{{ query }}', '{{ items has 1 }}') }, after(PAGE.replace('{{ query }}', '{{ items has 1 }}'), 'items ha'), project)
  assert.match(k.contents.value, /membership/)
})

test('hover on a capability member', () => {
  const text = PAGE.replace('{{ query }}', '{{ Auth.logout() }}')
  const h = hover({ ...docFor(PAGE), text }, after(text, 'Auth.log'), project)
  assert.match(h.contents.value, /async logout\(\)/)
})

test('definition: own members, capabilities, imports and component tags', () => {
  const doc = docFor(PAGE)
  assert.deepEqual(definition(doc, after(PAGE, 'this.que'), project), {
    uri: 'self',
    range: { start: { line: 9, character: 2 }, end: { line: 9, character: 7 } },
  })
  assert.equal(definition(doc, after(PAGE, 'import Ca'), project).uri, '/app/pages/components/Card.tyx')
  assert.equal(definition(doc, after(PAGE, '<Ca'), project).uri, '/app/pages/components/Card.tyx')

  const text = PAGE.replace('{{ query }}', '{{ Auth.user }}')
  const d = definition({ ...doc, text }, after(text, 'Auth.us'), project)
  assert.equal(d.uri, '/app/capabilities/Auth.tyx')
  assert.equal(d.range.start.line, 3)
})

test('document symbols carry ranges on the name', () => {
  const symbols = documentSymbols(docFor(PAGE))
  const items = symbols.find((s) => s.name === 'items')
  assert.deepEqual(items.range.start, { line: 8, character: 2 })
  assert.equal(symbols.find((s) => s.name === 'load').detail, 'action')
})
