import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, loadEnv } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'

async function check(label, fn) {
  try {
    const detail = await fn()
    console.log(`✔ ${label}${detail ? ` — ${detail}` : ''}`)
    return true
  } catch (err) {
    console.log(`✘ ${label} — ${err.message}`)
    return false
  }
}

export async function doctor() {
  const baseDir = process.cwd()
  console.log('Tylix Doctor\n')

  await check('.env present', async () => {
    const exists = await fs
      .access(path.join(baseDir, '.env'))
      .then(() => true)
      .catch(() => false)
    if (!exists) throw new Error('missing — add one or re-run create-tylix')
  })

  await loadEnv(baseDir)

  await check('tylix.config.js loads', async () => {
    await loadConfig(baseDir)
  })

  await check('app/routes/web.js exports routes()', async () => {
    const routesPath = path.join(baseDir, 'app', 'routes', 'web.js')
    const exists = await fs
      .access(routesPath)
      .then(() => true)
      .catch(() => false)
    if (!exists) throw new Error('app/routes/web.js missing')
    const mod = await import(pathToFileURL(routesPath).href)
    if (typeof mod.routes !== 'function')
      throw new Error('does not export an async "routes" function')
  })

  await check('app/useApi helpers present', async () => {
    const apiDir = path.join(baseDir, 'app', 'useApi')
    const exists = await fs
      .access(apiDir)
      .then(() => true)
      .catch(() => false)
    if (!exists) throw new Error('app/useApi/ missing')
    const files = (await fs.readdir(apiDir)).filter((f) => f.endsWith('.js'))
    if (files.length === 0)
      throw new Error('folder exists but has no helper files')
    return `${files.length} helper(s)`
  })

  await check('app/schedule.js exports schedule()', async () => {
    const schedulePath = path.join(baseDir, 'app', 'schedule.js')
    const exists = await fs
      .access(schedulePath)
      .then(() => true)
      .catch(() => false)
    if (!exists) throw new Error('app/schedule.js missing')
    const mod = await import(pathToFileURL(schedulePath).href)
    if (typeof mod.schedule !== 'function')
      throw new Error('does not export an async "schedule" function')
  })

  let adapter = null
  const connected = await check('database connects', async () => {
    adapter = await bootstrapDatabase()
  })

  if (connected && adapter) {
    await check('migrations table exists', async () => {
      const rows = await adapter
        .all('SELECT * FROM migrations')
        .catch(() => null)
      if (rows === null)
        throw new Error(
          'no migrations table — run "tylix migrate" at least once',
        )
    })

    await check('pending migrations', async () => {
      const migrationsDir = path.join(baseDir, 'database', 'migrations')
      const exists = await fs
        .access(migrationsDir)
        .then(() => true)
        .catch(() => false)
      if (!exists) return 'no migrations directory'

      const files = (await fs.readdir(migrationsDir)).filter((f) =>
        f.endsWith('.js'),
      )
      const ranRows = await adapter
        .all('SELECT * FROM migrations')
        .catch(() => [])
      const ranSet = new Set(ranRows.map((r) => r.filename))
      const pending = files.filter((f) => !ranSet.has(f))

      if (pending.length > 0)
        return `${pending.length} pending: ${pending.join(', ')}`
      return 'all applied'
    })

    await adapter.close()
  }

  console.log('\nDone.')
}
