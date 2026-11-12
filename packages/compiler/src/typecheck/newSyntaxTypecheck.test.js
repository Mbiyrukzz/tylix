import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Lexer } from '../lexer/Lexer.js'
import { Parser } from '../parser/Parser.js'
import { buildVirtualPageTs } from './buildVirtualTs.js'
import { typecheckSource } from './typecheckVirtualFile.js'

function check(script) {
  const pageNode = new Parser(new Lexer(script).tokenize()).parse()
  const { source } = buildVirtualPageTs(pageNode, 'Demo', null)
  return { source, diagnostics: typecheckSource(source) }
}

function assertClean(script) {
  const { source, diagnostics } = check(script)
  assert.deepEqual(
    diagnostics.map((d) => `${d.virtualLine}: ${d.message}`),
    [],
    `virtual source was:\n${source}`,
  )
}

test('a wrong local type is reported', () => {
  const { diagnostics } = check(`action { f() { const x: number = "a" } }`)
  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0].message, /string/)
})

test('typed locals, optional params, casts and satisfies typecheck', () => {
  assertClean(`
state { items(string[]): [] }
action {
  f(a: number, b?: string) {
    const x: number = a + 1
    const o = { v: 5 } satisfies { v: number }
    const first = this.items[0]!
    return [x, o.v, first, b as string | undefined]
  }
}`)
})

test('catch variables are any, including destructured ones', () => {
  assertClean(`
action {
  f() {
    try { throw new Error("x") } catch (e) { return e.message }
  }
  g() {
    try { throw new Error("x") } catch ({ message }) { return message }
  }
}`)
})

test('classes, including constructor-assigned fields, typecheck', () => {
  assertClean(`
action {
  f() {
    class A {
      x: number = 1
      static count: number = 0
      constructor(n: number) { this.n = n; A.count++ }
      get double(): number { return this.n * 2 }
      hello(): string { return "A" + this.n }
    }
    class B extends A {
      hello(): string { return "B" + super.hello() }
    }
    return new B(4).hello()
  }
}`)
})

test('generators and async generators typecheck', () => {
  assertClean(`
action {
  async f() {
    function* count() { yield 1; yield* [2, 3] }
    async function* agen() { yield 1 }
    let sum = 0
    for (const n of count()) { sum += n }
    for await (const n of agen()) { sum += n }
    return sum
  }
}`)
})

test('labels, blocks and object accessors typecheck', () => {
  assertClean(`
action {
  f() {
    let n = 0
    outer: for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (j == 1) { continue outer }
        n++
      }
    }
    { n = n + 1 }
    const o = { _v: 1, get v() { return this._v }, set v(x) { this._v = x } }
    return [n, o.v]
  }
}`)
})