import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makePermissions, patchWebRoutes, patchDatabaseSeeder, accessPageSource } from './makePermissions.js'
import { parsePageFile } from '../../../compiler/src/parser/parsePageFile.js'

test('patchWebRoutes registers the admin API inside protectedRoutes, once', () => {
  const web = `import type { Router } from '@tylix/core'
import { PostController } from '../controllers/PostController.js'

export async function protectedRoutes(router: Router) {
  const uploads = 1
}
`
  const out = patchWebRoutes(web, 'ts')
  assert.match(out, /import \{ PostController \} from '..\/controllers\/PostController.js'\nimport \{ accessRoutes \} from '.\/access.js'/)
  assert.match(out, /protectedRoutes\(router: Router\) \{\n  \/\/ Roles and permissions admin API \(app\/routes\/access\)\n  accessRoutes\(router\)/)
  assert.equal(patchWebRoutes(out, 'ts'), out)
})

test('patchWebRoutes adds protectedRoutes when the file has none', () => {
  const out = patchWebRoutes(`export async function publicRoutes(router) {}\n`, 'js')
  assert.match(out, /export async function protectedRoutes\(router\) \{\n  accessRoutes\(router\)\n\}/)
})

test('patchDatabaseSeeder calls the permission seeder first', () => {
  const out = patchDatabaseSeeder(`export async function seed() {\n  // e.g.\n}\n`)
  assert.match(out, /^import \{ seed as seedPermissions \} from '.\/PermissionSeeder.js'\n\nexport async function seed\(\) \{\n  \/\/ Roles and permissions from app\/permissions\n  await seedPermissions\(\)/)
  assert.equal(patchDatabaseSeeder(out), out)
  assert.equal(patchDatabaseSeeder('export const x = 1\n'), null)
})

test('the admin page parses as a page with its permission', () => {
  const { pageName, template, style } = parsePageFile(accessPageSource())
  assert.equal(pageName, 'AccessControl')
  assert.match(template, /role="dialog"/)
  assert.match(style, /\.acc-modal/)
})

test('make:permissions writes the files, patches the app, and keeps them on a second run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tylix-make-perms-'))
  try {
    await fs.writeFile(path.join(dir, 'tsconfig.json'), '{}')
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
    await fs.mkdir(path.join(dir, 'app', 'models'), { recursive: true })
    await fs.mkdir(path.join(dir, 'app', 'pages'), { recursive: true })
    await fs.mkdir(path.join(dir, 'app', 'routes'), { recursive: true })
    await fs.mkdir(path.join(dir, 'app', 'seeders'), { recursive: true })
    await fs.writeFile(path.join(dir, 'app', 'models', 'User.ts'), 'export class User {}\n')
    await fs.writeFile(path.join(dir, 'app', 'routes', 'web.ts'), "import type { Router } from '@tylix/core'\n\nexport async function protectedRoutes(router: Router) {\n}\n")
    await fs.writeFile(path.join(dir, 'app', 'seeders', 'DatabaseSeeder.ts'), 'export async function seed() {\n}\n')

    const first = await makePermissions({ baseDir: dir, quiet: true })
    for (const f of ['app/permissions.ts', 'app/models/Role.ts', 'app/controllers/AccessController.ts', 'app/routes/access.ts', 'app/pages/admin/access.tyx']) {
      assert.ok(first.written.includes(f), f)
    }
    assert.ok(first.written.some((f) => /^database\/migrations\/\d{14}_create_permission_tables\.ts$/.test(f)))
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'))
    assert.match(pkg.dependencies['@tylix/permissions'], /^\^\d+\.\d+\.\d+$/)

    const second = await makePermissions({ baseDir: dir, quiet: true })
    assert.deepEqual(second.written, [])
    assert.ok(second.kept.includes('app/permissions.ts'))
    const web = await fs.readFile(path.join(dir, 'app', 'routes', 'web.ts'), 'utf-8')
    assert.equal(web.match(/accessRoutes\(router\)/g).length, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
