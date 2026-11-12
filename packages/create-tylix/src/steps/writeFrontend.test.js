import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTemplate, FRONTENDS } from './writeFrontend.js'

const TEMPLATES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

test('keeps or drops @if blocks and removes the marker lines', () => {
  const source = ['a', '// @if auth', 'b', '// @endif', '{/* @if !auth */}', 'c', '{/* @endif */}', 'd'].join('\n')
  assert.equal(renderTemplate(source, { auth: true }), 'a\nb\nd')
  assert.equal(renderTemplate(source, { auth: false }), 'a\nc\nd')
})

test('nested blocks are kept only when every enclosing flag is on', () => {
  const source = ['// @if a', 'A', '// @if b', 'AB', '// @endif', '// @if !b', 'A!B', '// @endif', '// @endif', 'end'].join('\n')
  assert.equal(renderTemplate(source, { a: true, b: true }), 'A\nAB\nend')
  assert.equal(renderTemplate(source, { a: true, b: false }), 'A\nA!B\nend')
  assert.equal(renderTemplate(source, { a: false, b: true }), 'end')
  assert.equal(renderTemplate(source, { a: false, b: false }), 'end')
})

test('rejects unbalanced markers', () => {
  assert.throws(() => renderTemplate('// @if auth\nx', {}), /without @endif/)
  assert.throws(() => renderTemplate('x\n// @endif', {}), /without @if/)
})

for (const [name, frontend] of Object.entries(FRONTENDS)) {
  test(`${name}: every listed template exists and renders for every flag combination`, async () => {
    const dir = path.join(TEMPLATES_ROOT, frontend.templateDir)
    const files = [...frontend.base, ...frontend.auth, ...frontend.posts]
    for (const file of [...files, 'index.html', 'tsconfig.json', 'vite-env.d.ts']) {
      await fs.access(path.join(dir, `${file}.template`))
    }
    for (const file of files) {
      const source = await fs.readFile(path.join(dir, `${file}.template`), 'utf-8')
      for (const auth of [true, false]) {
        for (const posts of [true, false]) {
          for (const tailwind of [true, false]) {
            for (const ts of [true, false]) {
              const out = renderTemplate(source, { auth, posts, tailwind, ts })
              // A template marker is "@if word"; Angular's own "@if (...)"
              // control flow is not one.
              assert.doesNotMatch(out, /@if\s+!?\w|@endif\b/, `${file} left a marker`)
              // TypeScript-only frameworks (Angular) have no JS variant.
              const hasJsVariant = !frontend.entry.js.endsWith('.ts')
              if (!ts && hasJsVariant) {
                assert.doesNotMatch(out, /useApi<|^\s*type /m, `${file} leaks TypeScript into JavaScript`)
              }
            }
          }
        }
      }
    }
  })
}
