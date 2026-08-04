import fs from 'node:fs/promises'
import path from 'node:path'
import { detectLanguage } from '@tylix/shared'

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath)
    return filePath
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function removeMatching(dir, predicate) {
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  const removed = []
  for (const entry of entries) {
    if (predicate(entry)) {
      const full = path.join(dir, entry)
      await fs.unlink(full)
      removed.push(full)
    }
  }
  return removed
}

export class FeatureRemover {
  async remove(name, baseDir) {
    const results = {
      model: [],
      migration: [],
      validator: [],
      controller: [],
      apiHelper: [],
      manifest: null,
      dashboard: [],
    }

    const language = await detectLanguage(baseDir)
    const ext = language === 'typescript' ? 'ts' : 'js'

    const manifestDir = path.join(baseDir, 'app', 'Features', name)
    const manifestPath = path.join(manifestDir, 'feature.json')

    let manifest = null
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
    } catch {
      // no manifest — still try to clean up by name
    }

    const tableName = manifest?.table

    // Model: app/models/<Name>.<ext>
    results.model.push(
      ...(await removeMatching(
        path.join(baseDir, 'app', 'models'),
        (f) =>
          f === `${name}.${ext}` ||
          f === `${name}.${ext === 'ts' ? 'js' : 'ts'}`,
      )),
    )

    // Controller: app/controllers/<Name>Controller.<ext>
    results.controller.push(
      ...(await removeMatching(path.join(baseDir, 'app', 'controllers'), (f) =>
        f.startsWith(`${name}Controller`),
      )),
    )

    // Validator: app/validators/<Name>Validator.<ext>
    results.validator.push(
      ...(await removeMatching(path.join(baseDir, 'app', 'validators'), (f) =>
        f.startsWith(`${name}Validator`),
      )),
    )

    // API helper: app/useApi/<Name>.<ext>
    results.apiHelper.push(
      ...(await removeMatching(
        path.join(baseDir, 'app', 'useApi'),
        (f) =>
          f === `${name}.${ext}` ||
          f === `${name}.${ext === 'ts' ? 'js' : 'ts'}`,
      )),
    )
    // Migration: database/migrations/*_<table>*.ext — timestamp-prefixed, so match on table name
    if (tableName) {
      results.migration.push(
        ...(await removeMatching(
          path.join(baseDir, 'database', 'migrations'),
          (f) => f.includes(tableName),
        )),
      )
    }

    // Dashboard, if generated
    const dashboardDir = path.join(baseDir, 'resources', 'pages', name)
    try {
      await fs.rm(dashboardDir, { recursive: true, force: true })
      results.dashboard.push(dashboardDir)
    } catch {
      // ignore if not present
    }

    // Manifest / Features folder last
    try {
      await fs.rm(manifestDir, { recursive: true, force: true })
      results.manifest = manifestPath
    } catch {
      // ignore
    }

    return results
  }
}
