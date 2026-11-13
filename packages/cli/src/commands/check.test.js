import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCheck } from './check.js'

async function project(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-check-'))
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}')
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, text)
  }
  return dir
}

test('runCheck reports every broken .tyx file with positions', async () => {
  const dir = await project({
    'app/pages/Index.tyx': 'page Home\n\ntemplate\n  <p>hi</p>\n',
    'app/pages/Bad.tyx':
      'page Bad\n\naction\n  inc() {\n    this.n = = 1\n  }\n\ntemplate\n  <div>\n',
    'app/components/Card.tyx': 'component Card\n\ntemplate\n  <p>{{ a b }}</p>\n',
    'app/capabilities/posts.tyx': 'capability Posts\n\nstate\n  data: []\n',
    // generator templates share the extension and are skipped
    'app/components/gen.tyx': '/** Generated */\nimport { {{Model}} } from "x"\n',
  })
  try {
    const result = await runCheck({ baseDir: dir })
    assert.equal(result.checked, 4)
    assert.equal(result.typecheck, false)
    const found = result.files
      .flatMap((f) =>
        f.diagnostics.map((d) => `${path.relative(dir, f.file)}:${d.line}:${d.column}`),
      )
      .sort()
    assert.deepEqual(found, [
      'app/components/Card.tyx:4:11',
      'app/pages/Bad.tyx:5:14',
      'app/pages/Bad.tyx:9:3',
    ])
    assert.equal(result.errorCount, 3)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('runCheck can be limited to paths and forced to typecheck', async () => {
  const dir = await project({
    'app/pages/Typed.tyx':
      'page Typed\n\nstate\n  n(number): 0\n\ntemplate\n  <p>{{ n.toUpperCase() }}</p>\n',
    'app/pages/Bad.tyx': 'page Bad\n\ntemplate\n  <div>\n',
  })
  try {
    const result = await runCheck({
      baseDir: dir,
      paths: ['app/pages/Typed.tyx'],
      typecheck: true,
    })
    assert.equal(result.checked, 1)
    assert.deepEqual(
      result.files[0].diagnostics.map((d) => `${d.origin}:${d.line}`),
      ['typecheck:7'],
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
