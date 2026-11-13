import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createViewRenderer, renderTemplate } from '../template.js'

test('values are escaped; triple braces are raw', () => {
  assert.equal(renderTemplate('<p>{{ name }}</p>', { name: '<b>Ada</b> & co' }), '<p>&lt;b&gt;Ada&lt;/b&gt; &amp; co</p>')
  assert.equal(renderTemplate('{{{ html }}}', { html: '<b>ok</b>' }), '<b>ok</b>')
  assert.equal(renderTemplate('<a href="{{ url }}">', { url: 'https://x.dev/?a=1&b=2' }), '<a href="https://x.dev/?a=1&amp;b=2">')
})

test('dotted paths, null renders empty, missing throws', () => {
  assert.equal(renderTemplate('{{ user.name }}/{{ user.nick }}', { user: { name: 'Ada', nick: null } }), 'Ada/')
  assert.throws(() => renderTemplate('{{ nope }}', {}), /"nope" was not provided/)
})

test('if / else and each', () => {
  const t = '{{#if items}}<ul>{{#each items}}<li>{{ @index }}:{{ title }}{{#if done}} ✓{{/if}}</li>{{/each}}</ul>{{#else}}none{{/if}}'
  assert.equal(
    renderTemplate(t, { items: [{ title: 'A', done: true }, { title: 'B', done: false }] }),
    '<ul><li>0:A ✓</li><li>1:B</li></ul>',
  )
  assert.equal(renderTemplate(t, { items: [] }), 'none')
  assert.equal(renderTemplate('{{#each tags}}[{{ this }}]{{/each}}', { tags: ['x', '<y>'] }), '[x][&lt;y&gt;]')
})

test('view renderer reads .html and an optional .txt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailviews-'))
  fs.writeFileSync(path.join(dir, 'welcome.html'), '<h1>Hi {{ name }}</h1>')
  fs.writeFileSync(path.join(dir, 'welcome.txt'), 'Hi {{ name }}')
  fs.writeFileSync(path.join(dir, 'bare.html'), 'x')
  const render = createViewRenderer(dir)
  assert.deepEqual(await render('welcome', { name: 'Ada' }), { html: '<h1>Hi Ada</h1>', text: 'Hi Ada' })
  assert.deepEqual(await render('bare', {}), { html: 'x', text: undefined })
  await assert.rejects(render('../etc/passwd', {}), /Invalid mail view/)
})
