import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TemplateEngine } from './TemplateEngine.js'

test('replaces a single variable', () => {
  const engine = new TemplateEngine()
  const result = engine.render('class {{Model}} extends Model {}', {
    Model: 'Post',
  })
  assert.equal(result, 'class Post extends Model {}')
})

test('replaces multiple variables including repeats', () => {
  const engine = new TemplateEngine()
  const template = `export class {{Model}} extends Model {\n    static table = "{{table}}";\n}`
  const result = engine.render(template, { Model: 'Post', table: 'posts' })
  assert.equal(
    result,
    `export class Post extends Model {\n    static table = "posts";\n}`,
  )
})

test('throws when a required variable is missing', () => {
  const engine = new TemplateEngine()
  assert.throws(() => engine.render('{{Model}}', {}), /Model/)
})
