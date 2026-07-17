import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePage } from './generatePage.js'
import { reactive, effect } from '../runtime/reactive.js'
import { Parser } from '../parser/Parser.js'
import { Lexer } from '../lexer/Lexer.js'

function compileAndLoad(source, className = 'Page') {
  const tokens = new Lexer(source).tokenize()
  const page = new Parser(tokens).parse()
  const classSource = generatePage(page, className)
  // reactive must be in scope for the generated class body to run
  return new Function('reactive', `return ${classSource}`)(reactive)
}

test('generates working state initializers for array, object, and null values, not just numbers/strings', () => {
  const source = `
state
  items: []
  config: { enabled: true }
  selectedId: null
`
  const Page = compileAndLoad(source, 'TestPage')
  const instance = new Page()

  assert.deepEqual(instance.items, [])
  assert.deepEqual(instance.config, { enabled: true })
  assert.equal(instance.selectedId, null)
})

test('generates a class with reactive state accessible via this.<name>', () => {
  const Page = compileAndLoad(`state { count: 0 }`)
  const instance = new Page()
  assert.equal(instance.count, 0)
  instance.count = 5
  assert.equal(instance.count, 5)
})

test('state writes trigger reactive effects (proves no manual re-render wiring needed)', () => {
  const Page = compileAndLoad(`state { count: 0 }`)
  const instance = new Page()
  let seen = null

  effect(() => {
    seen = instance.count
  })

  assert.equal(seen, 0)
  instance.count = 42
  assert.equal(seen, 42)
})

test('generates working action methods that mutate state', () => {
  const source = `
state { count: 0 }
action {
  increment() {
    this.count = this.count + 1;
  }
}`
  const Page = compileAndLoad(source)
  const instance = new Page()

  instance.increment()
  assert.equal(instance.count, 1)
  instance.increment()
  assert.equal(instance.count, 2)
})

test('generates working computed getters derived from state', () => {
  const source = `
state { count: 3 }
computed {
  doubled() {
    return this.count * 2;
  }
}`
  const Page = compileAndLoad(source)
  const instance = new Page()

  assert.equal(instance.doubled, 6)
  instance.count = 10
  assert.equal(instance.doubled, 20)
})

test('computed getters are reactive when read inside an effect', () => {
  const source = `
state { count: 3 }
computed {
  doubled() {
    return this.count * 2;
  }
}`
  const Page = compileAndLoad(source)
  const instance = new Page()
  let seenDoubled = null

  effect(() => {
    seenDoubled = instance.doubled
  })

  assert.equal(seenDoubled, 6)
  instance.count = 5
  assert.equal(seenDoubled, 10)
})

test('generates a full realistic counter page end to end', () => {
  const source = `
state { count: 0 }
computed {
  doubled() {
    return this.count * 2;
  }
}
action {
  increment() {
    this.count = this.count + 1;
  }
  reset() {
    this.count = 0;
  }
}`
  const Page = compileAndLoad(source, 'Counter')
  const instance = new Page()

  assert.equal(instance.count, 0)
  assert.equal(instance.doubled, 0)

  instance.increment()
  instance.increment()
  instance.increment()

  assert.equal(instance.count, 3)
  assert.equal(instance.doubled, 6)

  instance.reset()
  assert.equal(instance.count, 0)
})
