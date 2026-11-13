// bind:, class:/style:, event modifiers, component children (<slot>),
// {{#await}} and {{@html}}, run in a real (jsdom) page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { renderPageDocument } from '../renderPageDocument.js'
import { parseTemplate } from '../parser/parseTemplate.js'
import { generateTemplate } from './generateTemplate.js'
import { diagnoseTyx } from '../diagnostics/diagnose.js'

function load(html) {
  return new Promise((resolve) => {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' })
    dom.window.document.addEventListener('DOMContentLoaded', () => setTimeout(() => resolve(dom), 0))
  })
}

async function mount(source, components = {}) {
  const dom = await load(await renderPageDocument(source, components))
  const { window } = dom
  const $ = (sel) => window.document.querySelector(`#app ${sel}`)
  const fire = (el, type, init = {}) => {
    const Ctor = type.startsWith('key') ? window.KeyboardEvent : type === 'click' ? window.MouseEvent : window.Event
    const ev = new Ctor(type, { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(ev)
    return ev
  }
  const type = (el, value) => {
    el.value = value
    fire(el, 'input')
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  return { window, $, fire, type, tick }
}

const compileError = (template) => {
  try {
    generateTemplate(parseTemplate(template))
  } catch (err) {
    return err.message
  }
  return null
}

// ------------------------------------------------------------------ bind:

test('bind:value keeps an input and state in sync', async () => {
  const { $, type, fire } = await mount(`page P
state
  query: "hi"
action
  reset() {
    this.query = "reset"
  }
template
  <div>
    <input bind:value="{{ query }}" />
    <p>{{ query }}</p>
    <button onclick="{{ reset() }}">r</button>
  </div>
`)
  assert.equal($('input').value, 'hi')
  type($('input'), 'typed')
  assert.equal($('p').textContent, 'typed')
  fire($('button'), 'click')
  assert.equal($('input').value, 'reset')
})

test('bind:value on a number input stores numbers and never fights the user', async () => {
  const { $, type } = await mount(`page P
state
  n: 1
template
  <div><input type="number" bind:value="{{ n }}" /><p>{{ typeof n }}:{{ n }}</p></div>
`)
  type($('input'), '2.50')
  assert.equal($('input').value, '2.50', 'what the user typed is left alone')
  assert.equal($('p').textContent, 'number:2.5')
  type($('input'), '')
  assert.equal($('p').textContent, 'object:')
})

test('bind:checked, bind:group (radio and checkbox) and select', async () => {
  const { $, window, fire } = await mount(`page P
state
  agree: false
  size: "m"
  tags: ["a"]
  color: "blue"
  picks: ["y"]
template
  <div>
    <input id="agree" type="checkbox" bind:checked="{{ agree }}" />
    <input id="s" type="radio" value="s" bind:group="{{ size }}" />
    <input id="m" type="radio" value="m" bind:group="{{ size }}" />
    <input id="ta" type="checkbox" value="a" bind:group="{{ tags }}" />
    <input id="tb" type="checkbox" value="b" bind:group="{{ tags }}" />
    <select id="color" bind:value="{{ color }}"><option value="red">r</option><option value="blue">b</option></select>
    <select id="picks" multiple bind:value="{{ picks }}"><option value="x">x</option><option value="y">y</option></select>
    <p>{{ agree }}|{{ size }}|{{ tags.join() }}|{{ color }}|{{ picks.join() }}</p>
  </div>
`)
  const doc = window.document
  assert.equal(doc.getElementById('m').checked, true)
  assert.equal(doc.getElementById('ta').checked, true)
  assert.equal(doc.getElementById('color').value, 'blue', 'set after the options exist')
  assert.deepEqual([...doc.getElementById('picks').selectedOptions].map((o) => o.value), ['y'])

  const click = (id) => {
    const el = doc.getElementById(id)
    el.checked = !el.checked || el.type === 'radio'
    fire(el, 'change')
  }
  click('agree')
  click('s')
  click('tb')
  click('ta')
  doc.getElementById('color').value = 'red'
  fire(doc.getElementById('color'), 'change')
  doc.getElementById('picks').options[0].selected = true
  fire(doc.getElementById('picks'), 'change')
  assert.equal($('p').textContent, 'true|s|b|red|x,y')
})

test('bind: errors are clear', () => {
  assert.match(compileError('<div bind:value="{{ x }}"></div>'), /value can only be bound on <input>, <textarea>, <select>/)
  assert.match(compileError('<input bind:value="{{ f() }}" />'), /must name a state field or a property/)
  assert.match(compileError('<input bind:value="{{ a?.b }}" />'), /must name a state field/)
  assert.match(compileError('{{#each x in xs}}<input bind:value="{{ x }}" />{{/each}}'), /loop variable/)
  assert.match(compileError('<input type="checkbox" bind:value="{{ x }}" />'), /use bind:checked/)
  assert.match(compileError('<input bind:nope="{{ x }}" />'), /Unsupported bind:nope/)
})

// ---------------------------------------------------------- class: style:

test('class: and style: directives, also next to a dynamic class', async () => {
  const { $, fire } = await mount(`page P
state
  active: true
  big: false
  color: "red"
  kind: "card"
action
  flip() {
    this.active = not this.active
    this.big = true
    this.color = null
    this.kind = "panel"
  }
template
  <div>
    <p class="{{ kind }}" class:active class:is-big="{{ big }}" style:color="{{ color }}" style:fontSize="{{ big ? '20px' : null }}" style:--gap="{{ 4 }}">x</p>
    <button onclick="{{ flip() }}">f</button>
  </div>
`)
  const p = $('p')
  assert.equal(p.className, 'card active')
  assert.equal(p.style.color, 'red')
  assert.equal(p.style.getPropertyValue('--gap'), '4')
  fire($('button'), 'click')
  assert.equal(p.className, 'panel is-big', 'the class attribute update kept the directive classes')
  assert.equal(p.style.color, '')
  assert.equal(p.style.fontSize, '20px')
})

test('class: shorthand needs a plain name', () => {
  assert.match(compileError('<p class:is-open></p>'), /needs a \{\{ \}\} value/)
})

// ---------------------------------------------------------- event modifiers

test('event modifiers behave', async () => {
  const { $, fire } = await mount(`page P
state
  log: []
action
  add(x) {
    this.log = [...this.log, x]
  }
template
  <div onclick="{{ add('outer') }}">
    <form onsubmit.prevent="{{ add('submit') }}"></form>
    <a href="#x" onclick.prevent.stop="{{ add('link') }}">a</a>
    <section onclick.self="{{ add('self') }}"><i>i</i></section>
    <button onclick.once.stop="{{ add('once') }}">o</button>
    <input id="k" onkeydown.enter="{{ add('enter') }}" />
    <textarea onkeydown.ctrl.enter="{{ add('ctrl-enter') }}"></textarea>
    <p>{{ log.join(',') }}</p>
  </div>
`)
  assert.equal(fire($('form'), 'submit').defaultPrevented, true)
  const linkEvent = fire($('a'), 'click')
  assert.equal(linkEvent.defaultPrevented, true)
  fire($('section i'), 'click') // target is <i>: .self skips, outer still runs
  fire($('section'), 'click')
  fire($('button'), 'click')
  fire($('button'), 'click') // .once: second click reaches only the outer div
  fire($('#k'), 'keydown', { key: 'a' })
  fire($('#k'), 'keydown', { key: 'Enter' })
  fire($('textarea'), 'keydown', { key: 'Enter' })
  fire($('textarea'), 'keydown', { key: 'Enter', ctrlKey: true })
  assert.equal($('p').textContent, 'submit,link,outer,self,outer,once,outer,enter,ctrl-enter')
})

test('event modifier errors', () => {
  assert.match(compileError('<a onclick.nope="{{ x() }}"></a>'), /Unknown event modifier "\.nope"/)
  assert.match(compileError('<a ontouchstart.passive.prevent="{{ x() }}"></a>'), /cannot be combined/)
})

// ---------------------------------------------------------- component slots

const CARD = `component Card
props
  title: string
template
  <article>
    <h2>{{ title }}</h2>
    <div class="body"><slot>no body</slot></div>
    <footer><slot name="footer" /></footer>
  </article>
`

test('component children render in <slot>, with the parent scope and reactivity', async () => {
  const { $, window, fire } = await mount(
    `page P
state
  items: ["a", "b"]
  n: 1
template
  <div>
    {{#each item in items}}
      <Card title="{{ item }}">
        <p>{{ item }} x {{ n }}</p>
        <small slot="footer">foot {{ item }}</small>
      </Card>
    {{/each}}
    <Card title="empty"></Card>
    <button onclick="{{ n = n + 1 }}">+</button>
  </div>
`,
    { Card: CARD },
  )
  const cards = window.document.querySelectorAll('#app article')
  assert.equal(cards.length, 3)
  assert.equal(cards[0].querySelector('.body').textContent, 'a x 1')
  assert.equal(cards[1].querySelector('footer').textContent, 'foot b')
  assert.equal(cards[1].querySelector('footer small').hasAttribute('slot'), false)
  assert.equal(cards[2].querySelector('.body').textContent, 'no body', 'fallback content')
  fire($('button'), 'click')
  assert.equal(cards[0].querySelector('.body').textContent, 'a x 2')
})

test('directives on components are refused', () => {
  assert.match(compileError('<Card class:x="{{ y }}"></Card>'), /only work on HTML elements/)
})

// ---------------------------------------------------------------- {{#await}}

test('{{#await x then v}} short form renders plain values at once', async () => {
  const { $ } = await mount(`page P
state
  label: "start"
template
  <div>{{#await label then text}}<em>{{ text }}</em>{{/await}}</div>
`)
  assert.equal($('em').textContent, 'start')
})

test('{{#await}} with real promises', async () => {
  const { $, fire, tick } = await mount(`page P
state
  p: null
action
  ok() {
    this.p = new Promise(r => setTimeout(() => r({ name: "Ada" }), 5))
  }
  bad() {
    this.p = Promise.reject(new Error("nope"))
  }
  slowThenFast() {
    this.p = new Promise(r => setTimeout(() => r({ name: "slow" }), 30))
    this.p = Promise.resolve({ name: "fast" })
  }
template
  <div>
    <button id="ok" onclick="{{ ok() }}">ok</button>
    <button id="bad" onclick="{{ bad() }}">bad</button>
    <button id="race" onclick="{{ slowThenFast() }}">race</button>
    <section>{{#await p}}<i>loading</i>{{#then v}}<b>{{ v ? v.name : "none" }}</b>{{#catch e}}<u>{{ e.message }}</u>{{/await}}</section>
  </div>
`)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  assert.equal($('section').textContent, 'none')
  fire($('#ok'), 'click')
  assert.equal($('section').textContent, 'loading')
  await wait(20)
  assert.equal($('section').textContent, 'Ada')
  fire($('#bad'), 'click')
  await tick()
  await tick()
  assert.equal($('section').textContent, 'nope')
  fire($('#race'), 'click')
  await wait(60)
  assert.equal($('section').textContent, 'fast', 'the replaced slow promise never shows')
})

// ------------------------------------------------------------------ @html

test('{{@html}} renders markup, updates, and never runs scripts', async () => {
  const { $, window, fire } = await mount(`page P
state
  body: "<b>bold</b><script>window.__ran = true</script>"
template
  <div>
    <article>{{@html body}}</article>
    <button onclick="{{ body = '<i>it</i>' }}">x</button>
  </div>
`)
  assert.equal($('article b').textContent, 'bold')
  assert.equal(window.__ran, undefined)
  fire($('button'), 'click')
  assert.equal($('article').innerHTML.replace(/<!--.*?-->/g, ''), '<i>it</i>')
})

// --------------------------------------------------------------- typecheck

test('a template variable named like a generated temporary still works', async () => {
  const { $ } = await mount(`page P
state
  list: ["x"]
template
  <div>{{#each v in list}}<b>{{ v }}</b>{{/each}}{{#each frag in list}}<i>{{ frag }}</i>{{/each}}</div>
`)
  assert.equal($('b').textContent, 'x')
  assert.equal($('i').textContent, 'x')
})

test('the new syntax typechecks, and then/catch names are in scope', () => {
  const r = diagnoseTyx(
    `page P

state
  q(string): ""
  on(boolean): false
  p(Promise<string>): Promise.resolve("x")

template
  <div>
    <input bind:value="{{ q }}" class:on="{{ on }}" style:color="{{ q }}" onkeydown.enter.prevent="{{ q = '' }}" />
    {{#await p}}…{{#then v}}{{ v.toUpperCase() }}{{#catch e}}{{ e }}{{/await}}
    {{@html q}}
  </div>
`,
    { typecheck: true },
  )
  assert.deepEqual(r.diagnostics.map((d) => d.message), [])
})
