import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exists, writeFile } from './writeFile.js'
import { detectLanguage } from '../config/detectLanguage.js'
import { colorsFor } from '../utils/colors.js'

test('exists, writeFile refuses to overwrite, detectLanguage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-fs-'))
  const file = path.join(dir, 'a', 'b.txt')
  assert.equal(await exists(file), false)
  await writeFile(file, 'x')
  assert.equal(await exists(file), true)
  await assert.rejects(writeFile(file, 'y'), /already exists/)
  await writeFile(file, 'y', { overwrite: true })
  assert.equal(await detectLanguage(dir), 'javascript')
  await fs.writeFile(path.join(dir, 'tylix.config.ts'), '')
  assert.equal(await detectLanguage(dir), 'typescript')
})

test('colours follow the stream, NO_COLOR and FORCE_COLOR', () => {
  const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR }
  try {
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
    assert.equal(colorsFor({ isTTY: false }).blue('x'), 'x')
    process.env.FORCE_COLOR = '1'
    assert.equal(colorsFor({ isTTY: false }).blue('x'), '\x1b[34mx\x1b[39m')
    process.env.NO_COLOR = ''
    assert.equal(colorsFor({ isTTY: true }).blue('x'), 'x', 'NO_COLOR wins, even empty')
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
})
