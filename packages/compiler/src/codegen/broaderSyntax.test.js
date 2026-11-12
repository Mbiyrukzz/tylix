import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePage } from './generatePage.js'
import { reactive } from '../runtime/reactive.js'
import { Parser } from '../parser/Parser.js'
import { Lexer } from '../lexer/Lexer.js'
import { buildVirtualPageTs } from '../typecheck/buildVirtualTs.js'
import { typecheckSource } from '../typecheck/typecheckVirtualFile.js'

function parse(source) {
  return new Parser(new Lexer(source).tokenize()).parse()
}

// Runs `body` as a computed getter and returns its value.
function run(body) {
  const js = generatePage(parse(`computed {\n  probe() {\n${body}\n  }\n}`), 'P')
  const P = new Function('reactive', `return ${js}`)(reactive)
  return new P().probe
}

function diagnostics(body) {
  const page = parse(`computed {\n  probe() {\n${body}\n  }\n}`)
  const { source } = buildVirtualPageTs(page, 'Demo', null)
  return { source, diags: typecheckSource(source) }
}

function assertClean(body) {
  const { source, diags } = diagnostics(body)
  assert.deepEqual(
    diags.map((d) => `${d.virtualLine}: ${d.message}`),
    [],
    `virtual source was:\n${source}`,
  )
}

test('postfix ++/-- evaluate to the old value, prefix to the new one', () => {
  assert.equal(run('let i = 1; const a = i++; const b = ++i; return a * 10 + b'), 13)
  assert.equal(run('let i = 5; const a = i--; return a * 10 + i'), 54)
  assert.equal(run('const o = { n: 1 }; const a = o.n++; return a + o.n'), 3)
})

test('postfix ++ on a following line starts a new statement', () => {
  assert.equal(run('let a = 1\nlet b = 1\na\n++b\nreturn a * 10 + b'), 12)
})

test('reactive state supports ++ and -- through the setter', () => {
  const js = generatePage(
    parse(`state { n: 1 }\naction { bump() { return this.n++ } }`),
    'P',
  )
  const page = new (new Function('reactive', `return ${js}`)(reactive))()
  assert.equal(page.bump(), 1)
  assert.equal(page.n, 2)
})

test('type, interface and enum declarations compile', () => {
  assert.equal(run('enum E { A, B } return E.B'), 1)
  assert.equal(
    run('interface P { a: number } type Q = P & { b?: string }; const p: Q = { a: 1 }; return p.a'),
    1,
  )
  assertClean('type M = { [K in "a" | "b"]: number }; const m: M = { a: 1, b: 2 }; return m.b')
})

test('generic arrow with a trailing comma <T,>', () => {
  assert.equal(run('const id = <T,>(x: T): T => x; return id<number>(3)'), 3)
  assertClean('const id = <T,>(x: T): T => x; return id<number>(3)')
})

test('constructor parameter properties assign fields (after super)', () => {
  assert.equal(run('class P { constructor(public x: number, private readonly y = 2) {} sum() { return this.x + this.y } } return new P(3).sum()'), 5)
  assert.equal(
    run('class A { constructor(public a: number) {} } class B extends A { constructor(public b: number) { super(1) } } const o = new B(2); return o.a + o.b'),
    3,
  )
  assertClean('class P { constructor(public x: number) {} } return new P(3).x')
})

test('a parameter literally named readonly is still a plain parameter', () => {
  assert.equal(run('function f(readonly: number) { return readonly } return f(4)'), 4)
})

test('abstract classes and members are checker-only', () => {
  const src =
    'abstract class A { abstract f(): number; abstract label: string; g() { return this.f() + 1 } } class B extends A { label = "b"; f() { return 1 } } return new B().g()'
  assert.equal(run(src), 2)
  assertClean(src)
  const { diags } = diagnostics('abstract class A { abstract f(): number } return new A()')
  assert.ok(diags.some((d) => /abstract/i.test(d.message)), 'instantiating an abstract class is reported')
})

test('function and method overload signatures', () => {
  const fn = 'function f(x: number): number\nfunction f(x: string): string\nfunction f(x: any) { return x } return f(1)'
  assert.equal(run(fn), 1)
  assertClean(fn)
  const method = 'class C { m(x: number): number; m(x: any) { return x } } return new C().m(2)'
  assert.equal(run(method), 2)
  assertClean(method)
})

test('a function expression without a body is still an error', () => {
  assert.throws(() => run('const f = function g(x: number): number; return 1'), /function body/)
})

test('a method missing its body on the same line is still an error', () => {
  assert.throws(() => run('class C { m() return 1 } return 1'), /method body/)
})
