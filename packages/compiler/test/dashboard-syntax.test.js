import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parsePageFile } from '../src/parser/parsePageFile.js'
import { Lexer } from '../src/lexer/Lexer.js'
import { Parser } from '../src/parser/Parser.js'
import { generatePage } from '../src/codegen/generatePage.js'
import { renderPageDocument } from '../src/renderPageDocument.js'

const SOURCE = `page Dashboard
title "Dashboard"
layout DashboardLayout
needs
    Auth
uses
    Theme
    Posts
prefetch
    Posts.latest
background
    Analytics
permissions
    posts.view
meta
    transition "fade"
    keepAlive true
    cache 10m
state
    search: ""
computed
    filteredPosts() {
        return Posts.where(post => post.title.contains(this.search))
    }
actions
    async publishPost(post) {
        await Posts.publish(post)
    }
template
<div>{{ search }}</div>
`

function parseScript() {
  const { script } = parsePageFile(SOURCE)
  const tokens = new Lexer(script).tokenize()
  return new Parser(tokens).parse()
}

test('parses all six page-level sections without throwing', () => {
  const page = parseScript()

  assert.equal(page.title, 'Dashboard')
  assert.equal(page.layout, 'DashboardLayout')
  assert.deepEqual(
    page.needs.map((n) => n.name),
    ['Auth'],
  )
  assert.deepEqual(
    page.uses.map((u) => u.name),
    ['Theme', 'Posts'],
  )
  assert.equal(page.prefetch[0].capability, 'Posts')
  assert.equal(page.prefetch[0].member, 'latest')
  assert.deepEqual(
    page.background.map((b) => b.name),
    ['Analytics'],
  )
  assert.deepEqual(
    page.permissions.map((p) => p.name),
    ['posts.view'],
  )

  const meta = Object.fromEntries(page.meta.map((m) => [m.key, m.value]))
  assert.equal(meta.transition, 'fade')
  assert.equal(meta.keepAlive, true)
  assert.equal(meta.cache, '10m')
})

test('generated page class is syntactically valid JS', () => {
  const page = parseScript()
  const classSource = generatePage(page, 'Dashboard')

  assert.doesNotThrow(() => new Function(classSource), classSource)
  assert.match(classSource, /async __ready\(\)/)
  assert.match(classSource, /resolveCapability\("Auth"\)\.ready\(\)/)
  assert.match(classSource, /resolveCapability\("Posts"\)\.latest\(\)/)
})

test('renderPageDocument compiles the full Dashboard against stub capabilities', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tylix-test-'))
  const capabilitiesDir = path.join(dir, 'capabilities')
  await mkdir(capabilitiesDir, { recursive: true })

  await writeFile(
    path.join(capabilitiesDir, 'Auth.tyx'),
    `capability Auth\nstate\n  user: null\naction\n  noop() {}\n`,
  )
  await writeFile(
    path.join(capabilitiesDir, 'Theme.tyx'),
    `capability Theme\nstate\n  mode: "dark"\naction\n  noop() {}\n`,
  )
  await writeFile(
    path.join(capabilitiesDir, 'Posts.tyx'),
    `capability Posts\nstate\n  data: []\naction\n  async latest() {}\n  where(fn) { return this.data.filter(fn) }\n`,
  )
  await writeFile(
    path.join(capabilitiesDir, 'Analytics.tyx'),
    `capability Analytics\nstate\n  visitorsToday: 0\naction\n  noop() {}\n`,
  )

  const html = await renderPageDocument(SOURCE, {}, { capabilitiesDir })
  assert.match(html, /<title>Dashboard<\/title>/)

  await rm(dir, { recursive: true, force: true })
})
