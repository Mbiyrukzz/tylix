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

test('non-ASCII identifiers work for state and locals', () => {
  const Page = compileAndLoad(`
state { café: 1 }
action {
  f() {
    const 変数 = 2
    return 変数 + this.café
  }
}`)
  const page = new Page()
  assert.equal(page.café, 1)
  assert.equal(page.f(), 3)
})

test('property names that exist on Object.prototype parse (toString)', () => {
  const Page = compileAndLoad(`
state { n: 5 }
action { f() { return this.n.toString() } }`)
  assert.equal(new Page().f(), '5')
})

test('a number literal as a member object is parenthesized', () => {
  const Page = compileAndLoad(`action { f() { return (5).toFixed(1) } }`)
  assert.equal(new Page().f(), '5.0')
})

test('unary plus and the comma operator', () => {
  const Page = compileAndLoad(`action { f() { return (1, 2, +"3") } }`)
  assert.equal(new Page().f(), 3)
})

test('array holes keep their positions', () => {
  const Page = compileAndLoad(`action { f() { return [1, , 3].length } }`)
  assert.equal(new Page().f(), 3)
})

test('tagged templates, including String.raw', () => {
  const Page = compileAndLoad(`
action {
  f() {
    const tag = (s, v) => s[0] + v + s[1];
    return tag\`a\${1}b\`
  }
}`)
  assert.equal(new Page().f(), 'a1b')

  const rawSource = [
    'action { f() {',
    '  return String.raw' + '`' + 'x\\ny' + '`',
    '} }',
  ].join('\n')
  assert.equal(new (compileAndLoad(rawSource))().f(), 'x\\ny')
})

test('labeled break and continue', () => {
  const Page = compileAndLoad(`
action {
  f() {
    let n = 0;
    outer: for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (j == 1) { continue outer }
        n++
      }
    }
    return n
  }
}`)
  assert.equal(new Page().f(), 3)
})

test('destructured catch parameter', () => {
  const Page = compileAndLoad(`
action {
  f() {
    try { throw new Error("boom") } catch ({ message }) { return message }
  }
}`)
  assert.equal(new Page().f(), 'boom')
})

test('typed mode gives the catch variable any', () => {
  const plain = parse(
    `action { f() { try { g() } catch (e) { h(e.message) } } }`,
  ).actions[0].body[0]
  assert.match(generateStatement(plain, true), /catch \(e: any\)/)
  assert.doesNotMatch(generateStatement(plain, false), /: any/)

  const destructured = parse(
    `action { f() { try { g() } catch ({ message }) { h(message) } } }`,
  ).actions[0].body[0]
  const typed = generateStatement(destructured, true)
  assert.match(typed, /catch \(__caught: any\)/)
  assert.match(typed, /const \{ message \} = __caught;/)
})

test('generators and yield', () => {
  const Page = compileAndLoad(`
action {
  f() {
    function* count() {
      yield 1
      yield 2
      yield* [3, 4]
    }
    return [...count()]
  }
}`)
  assert.deepEqual(new Page().f(), [1, 2, 3, 4])
})

test('object getters and setters', () => {
  const Page = compileAndLoad(`
action {
  f() {
    const o = {
      _v: 1,
      get v() { return this._v },
      set v(x) { this._v = x * 2 }
    }
    o.v = 5
    return o.v
  }
}`)
  assert.equal(new Page().f(), 10)
})

test('classes: fields, static, accessors, extends and super', () => {
  const Page = compileAndLoad(`
action {
  f() {
    class A {
      x = 1
      static count = 0
      constructor(n) { this.n = n; A.count++ }
      get double() { return this.n * 2 }
      hello() { return "A" + this.n }
    }
    class B extends A {
      hello() { return "B" + super.hello() }
    }
    const b = new B(4)
    return [b.hello(), b.double, b.x, A.count]
  }
}`)
  assert.deepEqual(new Page().f(), ['BA4', 8, 1, 1])
})

test('satisfies is stripped from JS output', () => {
  const Page = compileAndLoad(`
action { f() { return ({ a: 1 } satisfies { a: number }).a } }`)
  assert.equal(new Page().f(), 1)
})

test('block statements and debugger parse', () => {
  const Page = compileAndLoad(`
action {
  f() {
    let n = 1
    { n = n + 1 }
    return n
  }
}`)
  assert.equal(new Page().f(), 2)
})

test('for await over an async iterable', async () => {
  const Page = compileAndLoad(`
action {
  async f() {
    async function* gen() { yield 1; yield 2 }
    let sum = 0
    for await (const x of gen()) { sum += x }
    return sum
  }
}`)
  assert.equal(await new Page().f(), 3)
})

test('unsupported constructs give specific messages', () => {
  assert.throws(() => parse(`action { f() { using x = y } }`), /not supported/)
  assert.throws(() => parse(`action { f() { import x } }`), /not supported/)
  assert.throws(
    () => parse(`action { f() { switch a { case 1: { } } } }`),
    /braces, not a colon/,
  )
})