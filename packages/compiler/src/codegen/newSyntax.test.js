import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePage } from './generatePage.js'
import { generateStatement } from './generateStatement.js'
import { reactive } from '../runtime/reactive.js'
import { Parser } from '../parser/Parser.js'
import { Lexer } from '../lexer/Lexer.js'

function parse(source) {
  return new Parser(new Lexer(source).tokenize()).parse()
}

function compileAndLoad(source, className = 'Page') {
  const classSource = generatePage(parse(source), className)
  return new Function('reactive', `return ${classSource}`)(reactive)
}

test('typed locals and optional params run, and types are stripped from JS', () => {
  const Page = compileAndLoad(`
state { n: 0 }
action {
  run(a: number, b?: string) {
    const x: number = a + 1
    this.n = x
  }
}`)
  const page = new Page()
  page.run(2)
  assert.equal(page.n, 3)
})

test('typed mode keeps local type annotations, JS mode drops them', () => {
  const node = parse(`action { f() { const x: number = 1 } }`).actions[0].body[0]
  assert.match(generateStatement(node, true), /const x: number = 1;/)
  assert.doesNotMatch(generateStatement(node, false), /number/)
})

test('as casts and non-null assertions compile away in JS', () => {
  const Page = compileAndLoad(`
action {
  f() {
    const o: any = { v: 5 }
    return (o.v as number) + o!.v
  }
}`)
  assert.equal(new Page().f(), 10)
})

test('arrow functions accept return types', () => {
  const Page = compileAndLoad(`
state { n: 4 }
computed {
  dbl() {
    const f = (x: number): number => x * 2
    return f(this.n)
  }
}`)
  assert.equal(new Page().dbl, 8)
})

test('has works on arrays, strings and Sets', () => {
  const Page = compileAndLoad(`
state { s: new Set(["a"]), arr: ["x", "y"], str: "hello" }
computed {
  inSet() { return this.s has "a" }
  notInSet() { return this.s has "z" }
  inArr() { return this.arr has "y" }
  inStr() { return this.str has "ell" }
}`)
  const page = new Page()
  assert.equal(page.inSet, true)
  assert.equal(page.notInSet, false)
  assert.equal(page.inArr, true)
  assert.equal(page.inStr, true)
})

test('a compound-assignment target that mutates is a compile error', () => {
  assert.throws(
    () => parse(`action { f() { this.a[this.i++] += 1 } }`),
    /run twice/,
  )
})

test('var still gives a specific message', () => {
  assert.throws(() => parse(`action { f() { var x = 1 } }`), /'var' is not supported/)
})

test('an arrow function works as a state initializer', () => {
  const Page = compileAndLoad(`state { one: () => 1 }`)
  assert.equal(new Page().one(), 1)
})