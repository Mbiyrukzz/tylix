import fs from 'node:fs/promises'
import path from 'node:path'

export async function listFeatures() {
  const baseDir = process.cwd()
  const featuresDir = path.join(baseDir, 'app', 'Features')

  let entries
  try {
    entries = await fs.readdir(featuresDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('\nNo features found (app/Features does not exist yet).\n')
      return
    }
    throw err
  }

  const featureDirs = entries.filter((e) => e.isDirectory())

  if (featureDirs.length === 0) {
    console.log('\nNo features found.\n')
    return
  }

  const manifests = []
  for (const dir of featureDirs) {
    const manifestPath = path.join(featuresDir, dir.name, 'feature.json')
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8')
      manifests.push(JSON.parse(raw))
    } catch {
      manifests.push({ name: dir.name, table: '(no manifest)', fields: [] })
    }
  }

  console.log(`\nFeatures (${manifests.length}):\n`)
  for (const m of manifests) {
    console.log(`  ${m.name}`)
    console.log(`    table:      ${m.table}`)
    console.log(`    controller: ${m.controller ?? '-'}`)
    console.log(`    validator:  ${m.validator ?? '-'}`)
    console.log(`    language:   ${m.language ?? '-'}`)
    console.log(`    auth:       ${Boolean(m.auth)}`)
    console.log(
      `    fields:     ${(m.fields ?? []).map((f) => f.name).join(', ') || '-'}`,
    )
    console.log()
  }
}
