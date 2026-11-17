import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
import { renderPageDocument } from './renderPageDocument.js'

const AUTH = `capability Auth

state
  user: null
  loading: true

init
  async {
    this.user = window.__TEST_USER__
    this.loading = false
  }
`

const PAGE = `page Admin

needs
  Auth

permissions
  users.manage

template
  <div>
    <h1>Admin</h1>
    {{#if can("posts.delete")}}<button id="del">Delete</button>{{/if}}
    {{#if hasRole("admin")}}<p id="role">admin</p>{{/if}}
    {{#if canAny(["billing.view", "users.manage"])}}<p id="any">any</p>{{/if}}
  </div>
`

async function render(user, { enforced = true, source = PAGE } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-perm-page-'))
  await fs.writeFile(path.join(dir, 'Auth.tyx'), AUTH)
  try {
    const html = await renderPageDocument(source, {}, {
      capabilitiesDir: dir,
      headFile: path.join(dir, 'none.html'),
      shellFile: path.join(dir, 'none.html'),
      loadingFile: path.join(dir, 'none.tyx'),
      permissionsEnforced: enforced,
      stylesheets: [],
    })
    const seeded = html.replace('<head>', `<head><script>window.__TEST_USER__ = ${JSON.stringify(user)};</script>`)
    // A navigation (the login redirect) is "not implemented" in JSDOM.
    const navigations = []
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', (err) => {
      if (/navigation/i.test(err.message)) navigations.push(err.message)
    })
    const dom = new JSDOM(seeded, {
      runScripts: 'dangerously',
      url: 'http://localhost/admin',
      virtualConsole,
      beforeParse(window) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      },
    })
    await new Promise((r) => setTimeout(r, 50))
    return { doc: dom.window.document, navigations, dom }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const admin = { id: 1, access: { roles: ['admin'], permissions: ['users.*', 'posts.*'], denied: ['posts.delete'], superAdmin: false } }

test('a page with its permissions renders, and can()/hasRole() follow the user', async () => {
  const { doc } = await render(admin)
  assert.equal(doc.querySelector('h1')?.textContent, 'Admin')
  assert.equal(doc.getElementById('del'), null) // denied
  assert.ok(doc.getElementById('role'))
  assert.ok(doc.getElementById('any'))
})

test('a signed-in user without the permission gets the 403 panel', async () => {
  const { doc } = await render({ id: 2, access: { roles: [], permissions: ['posts.view'], denied: [], superAdmin: false } })
  assert.equal(doc.querySelector('h1')?.textContent, 'You don’t have access to this page')
  assert.match(doc.body.textContent, /Needs: users\.manage/)
})

test('a guest is sent to login and back', async () => {
  const { doc, navigations } = await render(null)
  assert.equal(navigations.length, 1)
  assert.equal(doc.querySelector('h1'), null)
})

test('without app/permissions the block is a no-op', async () => {
  const { doc } = await render({ id: 3 }, { enforced: false })
  assert.equal(doc.querySelector('h1')?.textContent, 'Admin')
})

test('a page member named can wins over the helper', async () => {
  const source = `page Own

needs
  Auth

action
  can(x) {
    return x is "mine"
  }

template
  <div>{{#if can("mine")}}<b id="own">own</b>{{/if}}</div>
`
  const { doc } = await render({ id: 4, access: { roles: [], permissions: [], denied: [], superAdmin: false } }, { source })
  assert.ok(doc.getElementById('own'))
})

test('style sections of native components reach the page', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-comp-style-'))
  try {
    const card = 'component Card\n\ntemplate\n<div class="card">hi</div>\n\nstyle\n.card { color: rebeccapurple; }\n'
    const html = await renderPageDocument('page P\n\ntemplate\n<div><Card /><Card /></div>\n', { Card: card }, {
      capabilitiesDir: dir,
      headFile: path.join(dir, 'x'),
      shellFile: path.join(dir, 'x'),
      loadingFile: path.join(dir, 'x'),
      stylesheets: [],
    })
    assert.equal(html.match(/\.card \{ color: rebeccapurple; \}/g)?.length, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
