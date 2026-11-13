// Tokenizes sample .tyx text with the same engine VS Code uses and
// checks the scopes of key tokens.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const require = createRequire(import.meta.url)
const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'))
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  async loadGrammar(scopeName) {
    // VS Code ships source.js and source.css; a one-rule stand-in is
    // enough to see that a region was handed to them.
    if (scopeName !== 'source.tyx') {
      const stub = { scopeName, patterns: [{ match: '[A-Za-z]+', name: `stub.${scopeName}` }] }
      return vsctm.parseRawGrammar(JSON.stringify(stub), 'stub.json')
    }
    const path = new URL('../syntaxes/tylix.tmLanguage.json', import.meta.url)
    return vsctm.parseRawGrammar(fs.readFileSync(path, 'utf-8'), path.pathname)
  },
})
const grammar = await registry.loadGrammar('source.tyx')

// [{ text, scopes }] for every token of every line.
function tokenize(text) {
  let stack = vsctm.INITIAL
  const out = []
  for (const line of text.split('\n')) {
    const r = grammar.tokenizeLine(line, stack)
    for (const t of r.tokens) {
      out.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes })
    }
    stack = r.ruleStack
  }
  return out
}

// Scopes of the nth token whose text is exactly `text`.
function scopesOf(tokens, text, nth = 0) {
  const found = tokens.filter((t) => t.text === text)
  assert.ok(found[nth], `no token "${text}" (#${nth}); tokens: ${tokens.map((t) => t.text).join('|')}`)
  return found[nth].scopes.join(' ')
}

const PAGE = `page PostsIndex

import Card from "./components/Card"

title "Posts"

state
  posts(Post[]): []
  query: ""

computed
  filtered() {
    if this.query is "" and not Auth.user exists {
      return this.posts
    }
    return this.posts.filter(p => p.title has this.query)
  }

action
  async load() {
    const result = await useApi(\`/api/posts?q=\${this.query}\`)
  }

template
  <div class="list">
    <input value="{{ query }}" oninput="{{ query = $event.target.value }}" />
{{#if posts.length > 0}}
    <Card title="{{ p.title }}" />
{{#else}}
    <p>No posts &amp; nothing</p>
{{/if}}
    <pre>{{ raw }}</pre>
  </div>

style
  .list { color: red }
`

const tokens = tokenize(PAGE)

test('header and sections', () => {
  assert.match(scopesOf(tokens, 'page'), /storage\.type\.class\.tylix/)
  assert.match(scopesOf(tokens, 'PostsIndex'), /entity\.name\.type\.class\.tylix/)
  for (const kw of ['title', 'state', 'computed', 'action', 'template', 'style']) {
    assert.match(scopesOf(tokens, kw), /keyword\.control\.section\.tylix/, kw)
  }
})

test('imports', () => {
  assert.match(scopesOf(tokens, 'import'), /keyword\.control\.import/)
  assert.match(scopesOf(tokens, 'Card'), /entity\.name\.type\.component/)
  assert.match(scopesOf(tokens, './components/Card'), /string\.quoted\.double/)
})

test('state entries with types', () => {
  assert.match(scopesOf(tokens, 'posts'), /variable\.other\.property\.tylix/)
  assert.match(scopesOf(tokens, 'Post[]'), /entity\.name\.type\.tylix/)
})

test('script keywords, word operators and capabilities', () => {
  assert.match(scopesOf(tokens, 'if'), /keyword\.control\.tylix/)
  for (const w of ['is', 'and', 'not', 'exists', 'has']) {
    assert.match(scopesOf(tokens, w), /keyword\.operator\.word\.tylix/, w)
  }
  assert.match(scopesOf(tokens, 'Auth'), /support\.class\.capability/)
  assert.match(scopesOf(tokens, 'this'), /variable\.language\.this/)
  assert.match(scopesOf(tokens, 'async'), /storage\.type\.tylix/)
  assert.match(scopesOf(tokens, 'filtered'), /entity\.name\.function/)
  assert.match(scopesOf(tokens, '${'), /punctuation\.definition\.template-expression\.begin/)
})

test('template: tags, attributes, interpolations, blocks', () => {
  assert.match(scopesOf(tokens, 'div'), /entity\.name\.tag\.html/)
  assert.match(scopesOf(tokens, 'class'), /entity\.other\.attribute-name/)
  assert.match(scopesOf(tokens, '$event'), /variable\.language\.event/)
  const inAttr = tokens.find((t) => t.text === 'query' && t.scopes.includes('meta.template.tylix'))
  assert.ok(inAttr.scopes.includes('meta.embedded.expression.tylix'))
  assert.ok(inAttr.scopes.includes('variable.other.readwrite.tylix'))
  assert.match(scopesOf(tokens, '#if'), /keyword\.control\.block\.tylix/)
  assert.match(scopesOf(tokens, '#else'), /keyword\.control\.block\.tylix/)
  assert.match(scopesOf(tokens, '/if'), /keyword\.control\.block\.tylix/)
  assert.match(scopesOf(tokens, 'Card', 1), /support\.class\.component\.tylix/)
  assert.match(scopesOf(tokens, '&amp;'), /constant\.character\.entity/)
  assert.match(scopesOf(tokens, 'template'), /keyword\.control\.section/)
  assert.ok(scopesOf(tokens, 'div').includes('meta.template.tylix'))
})

test('<pre> content stays raw', () => {
  assert.match(scopesOf(tokens, '{{ raw }}'), /markup\.raw\.tylix/)
})

test('style section is CSS', () => {
  assert.match(scopesOf(tokens, 'color'), /meta\.style\.tylix.*stub\.source\.css/)
})

test('a generator template is not highlighted as Tylix', () => {
  const gen = tokenize('/**\n * Generated by Tylix\n */\nimport { {{Model}} } from "x";\nstate\n')
  assert.ok(gen.every((t) => t.scopes.includes('meta.generator-template.tylix')))
  assert.ok(!gen.some((t) => t.scopes.some((s) => s.includes('section.tylix'))))
  assert.match(scopesOf(gen, '{{Model}}'), /variable\.parameter\.placeholder/)
})

test('capability files', () => {
  const cap = tokenize('capability Posts\n\nstate\n  data: []\n\ninit\n  async {\n    await this.load()\n  }\n')
  assert.match(scopesOf(cap, 'capability'), /storage\.type\.class/)
  assert.match(scopesOf(cap, 'init'), /keyword\.control\.section/)
  assert.match(scopesOf(cap, 'load'), /entity\.name\.function/)
})

test('await blocks, @html, directives and event modifiers', () => {
  const t = tokenize(`page P

template
  {{#await load() then posts}}<p>{{ posts }}</p>{{#catch err}}x{{/await}}
  {{@html body}}
  <input bind:value="{{ q }}" class:active="{{ on }}" onkeydown.enter.prevent="{{ go() }}" />
`)
  assert.match(scopesOf(t, '#await'), /keyword\.control\.block/)
  assert.match(scopesOf(t, '#catch'), /keyword\.control\.block/)
  assert.match(scopesOf(t, '/await'), /keyword\.control\.block/)
  assert.match(scopesOf(t, '@html'), /keyword\.control\.block/)
  assert.match(scopesOf(t, 'bind'), /keyword\.other\.directive/)
  assert.match(scopesOf(t, 'class'), /keyword\.other\.directive/)
  assert.match(scopesOf(t, '.enter.prevent'), /keyword\.other\.modifier/)
})
