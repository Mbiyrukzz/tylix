import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeBackendStructure } from './writeBackendStructure.js'

async function inTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-backend-'))
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    return await fn(dir)
  } finally {
    process.chdir(cwd)
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const read = (dir, file) => fs.readFile(path.join(dir, 'app1', file), 'utf-8')

test('writes a guide per backend folder, an example middleware, tests and a README', () =>
  inTempDir(async (dir) => {
    await writeBackendStructure({ projectName: 'app1', frontend: 'react', language: 'typescript', authEnabled: true, starter: 'starter' })
    for (const folder of ['controllers', 'models', 'routes', 'services', 'middleware', 'validators', 'jobs', 'mail', 'seeders']) {
      assert.match(await read(dir, `app/${folder}/README.md`), /^# /, folder)
    }
    assert.match(await read(dir, 'app/middleware/logRequests.ts'), /import type \{ TylixRequest, TylixResponse \}/)
    const testFile = await read(dir, 'tests/api.test.ts')
    assert.match(testFile, /let client: TestClient/)
    assert.match(testFile, /public posts are open to everyone/)
    assert.match(testFile, /the current user needs a login/)
    const readme = await read(dir, 'README.md')
    assert.match(readme, /React pages on a Tylix backend/)
    assert.match(readme, /app\/frontend\//)
    assert.match(await read(dir, 'app/routes/README.md'), /web\.ts/)
  }))

test('JavaScript and no-auth variants', () =>
  inTempDir(async (dir) => {
    await writeBackendStructure({ projectName: 'app1', frontend: 'tylix', language: 'javascript', authEnabled: false, starter: 'blank' })
    assert.doesNotMatch(await read(dir, 'app/middleware/logRequests.js'), /import type/)
    const testFile = await read(dir, 'tests/api.test.js')
    assert.doesNotMatch(testFile, /type TestClient|: TestClient|\/api\/me|public\/posts/)
    assert.match(testFile, /answers 404/)
    assert.match(await read(dir, 'README.md'), /app\/pages\//)
  }))

test('never replaces files that already exist', () =>
  inTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, 'app1', 'tests'), { recursive: true })
    await fs.writeFile(path.join(dir, 'app1', 'tests', 'api.test.js'), 'mine')
    await fs.writeFile(path.join(dir, 'app1', 'README.md'), 'my readme')
    await writeBackendStructure({ projectName: 'app1', frontend: 'vue', language: 'javascript', authEnabled: true, starter: 'starter' })
    assert.equal(await read(dir, 'tests/api.test.js'), 'mine')
    assert.equal(await read(dir, 'README.md'), 'my readme')
  }))
