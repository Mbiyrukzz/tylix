import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadEnv, parseEnv, envSource } from './loadEnv.js'

const KEYS = ['T_PLAIN', 'T_COMMENT', 'T_SINGLE', 'T_DOUBLE', 'T_MULTI', 'T_REF', 'T_DEFAULT', 'T_SHELL', 'T_LOCAL', 'T_MODE', 'T_CYCLE_A', 'T_CYCLE_B', 'APP_ENV', 'T_HASH', 'T_ESC']
beforeEach(() => {
  for (const key of KEYS) delete process.env[key]
})

async function project(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-env-'))
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text)
  return dir
}

test('parseEnv: comments, quotes, escapes and multi-line values', () => {
  const entries = Object.fromEntries(
    parseEnv(
      [
        '﻿# a comment',
        'T_PLAIN=hello',
        'export T_COMMENT=value # trailing comment',
        'T_HASH=abc#def',
        "T_SINGLE='literal ${X} \\n'",
        'T_DOUBLE="a\\nb \\"q\\""',
        'T_MULTI="line one',
        'line two"',
        'not a line',
        '1BAD=x',
      ].join('\n'),
    ).map(([key, value, kind]) => [key, { value, kind }]),
  )
  assert.equal(entries.T_PLAIN.value, 'hello')
  assert.equal(entries.T_COMMENT.value, 'value')
  assert.equal(entries.T_HASH.value, 'abc#def', 'a # without a space before it is kept')
  assert.deepEqual(entries.T_SINGLE, { value: 'literal ${X} \\n', kind: 'literal' })
  assert.equal(entries.T_DOUBLE.value, 'a\nb "q"')
  assert.equal(entries.T_MULTI.value, 'line one\nline two')
  assert.equal(entries['1BAD'], undefined)
})

test('loadEnv: expansion, shell wins, layered files, sources', async () => {
  process.env.T_SHELL = 'from shell'
  const dir = await project({
    '.env': [
      'T_PLAIN=base',
      'T_REF=${T_PLAIN}/api',
      'T_DEFAULT=${T_MISSING:-fallback}',
      'T_SHELL=from file',
      'T_LOCAL=base',
      'T_MODE=base',
      'T_CYCLE_A=${T_CYCLE_B}',
      'T_CYCLE_B=${T_CYCLE_A}',
      'T_ESC="cost \\${T_PLAIN}"',
      'APP_ENV=staging',
    ].join('\n'),
    '.env.local': 'T_LOCAL=local\nT_MODE=local',
    '.env.staging': 'T_MODE=staging\nT_PLAIN=staged',
  })
  await loadEnv(dir)
  assert.equal(process.env.T_PLAIN, 'staged', '.env.<mode> beats .env')
  assert.equal(process.env.T_REF, 'staged/api', 'expansion uses the winning value')
  assert.equal(process.env.T_DEFAULT, 'fallback')
  assert.equal(process.env.T_SHELL, 'from shell')
  assert.equal(process.env.T_LOCAL, 'local')
  assert.equal(process.env.T_MODE, 'local', '.env.local beats .env.<mode>')
  assert.equal(process.env.T_CYCLE_A, '', 'a cycle expands to empty instead of hanging')
  assert.equal(process.env.T_ESC, 'cost ${T_PLAIN}')
  assert.equal(envSource('T_MODE'), '.env.local')
  assert.equal(envSource('T_PLAIN'), '.env.staging')
  assert.equal(envSource('T_SHELL'), undefined)
})

test('loadEnv: no .env is fine; .env.local is skipped in tests', async () => {
  await loadEnv(await project({}))
  process.env.APP_ENV = 'test'
  await loadEnv(await project({ '.env': 'T_LOCAL=base', '.env.local': 'T_LOCAL=local' }))
  assert.equal(process.env.T_LOCAL, 'base')
})
