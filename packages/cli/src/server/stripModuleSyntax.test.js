import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripModuleSyntax } from './stripModuleSyntax.js'

const lines = (...l) => l.join('\n')

test('removes export from declarations', () => {
  const out = stripModuleSyntax(
    lines('export const a = 1', 'export async function b() {}', 'export class C {}'),
  )
  assert.doesNotMatch(out, /export/)
  assert.match(out, /const a = 1/)
  assert.match(out, /async function b/)
})

test('removes single-line and multi-line imports', () => {
  const out = stripModuleSyntax(
    lines("import x from './x.js'", 'import {', '  a,', '  b,', "} from './y.js'", 'const z = 1'),
  )
  assert.doesNotMatch(out, /import|from/)
  assert.match(out, /const z = 1/)
})

test('removes export lists and re-exports', () => {
  const out = stripModuleSyntax(
    lines('const a = 1, b = 2', 'export { a, b }', "export { c } from './c.js'", "export * from './d.js'"),
  )
  assert.doesNotMatch(out, /export|from/)
  assert.match(out, /const a = 1, b = 2/)
})

test('export default keeps the value', () => {
  const out = stripModuleSyntax('export default 42')
  assert.equal(out.trim(), '42')
})

test('leaves export inside a multi-line template literal', () => {
  const out = stripModuleSyntax(
    lines('const sql = `', 'export const notCode = 1', '`', 'export const real = 2'),
  )
  assert.match(out, /export const notCode/)
  assert.doesNotMatch(out, /export const real/)
  assert.match(out, /const real = 2/)
})

test('leaves export inside a nested template expression', () => {
  const out = stripModuleSyntax(
    'const a = `x ${ `\nexport const inner = 1` } y`\nexport const real = 3',
  )
  assert.match(out, /export const inner/)
  assert.doesNotMatch(out, /export const real/)
})

test('leaves export inside strings and comments', () => {
  const out = stripModuleSyntax(
    lines(
      "const s = 'export const x'",
      '// export const y',
      '/* export const z */',
      'export const real = 1',
    ),
  )
  assert.match(out, /'export const x'/)
  assert.match(out, /\/\/ export const y/)
  assert.match(out, /\/\* export const z \*\//)
  assert.doesNotMatch(out, /export const real/)
})

test('a quote inside a regex does not confuse the scanner', () => {
  const out = stripModuleSyntax(
    lines("const r = /['\"]/g", 'export const real = 1'),
  )
  assert.doesNotMatch(out, /export const real/)
})

test('division is not mistaken for a regex', () => {
  const out = stripModuleSyntax(lines('const a = 10 / 2 / 5', 'export const b = 1'))
  assert.doesNotMatch(out, /export/)
})

test('dynamic import and import.meta are untouched', () => {
  const src = lines("const m = await import('./x.js')", 'const u = import.meta.url')
  assert.equal(stripModuleSyntax(src), src)
})

test('a property named export is untouched', () => {
  const src = 'const v = obj.export + other.import'
  assert.equal(stripModuleSyntax(src), src)
})

test('keeps line count and positions', () => {
  const src = lines("import a from 'a'", 'export const b = 1', 'const c = 2')
  const out = stripModuleSyntax(src)
  assert.equal(out.length, src.length)
  assert.equal(out.split('\n').length, 3)
  assert.match(out.split('\n')[2], /const c = 2/)
})