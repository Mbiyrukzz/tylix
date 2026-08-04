import path from 'node:path'
import { FeatureRemover } from '@tylix/generator'

export async function removeFeature(name, { yes = false } = {}) {
  const baseDir = process.cwd()

  if (!yes) {
    const readline = await import('node:readline/promises')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const answer = await rl.question(
      `This will delete all generated files for feature "${name}" (model, migration, controller, validator, API helper, dashboard, manifest). Continue? (y/N) `,
    )
    rl.close()
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.')
      return
    }
  }

  const remover = new FeatureRemover()
  const results = await remover.remove(name, baseDir)

  const anyRemoved =
    results.model.length ||
    results.migration.length ||
    results.validator.length ||
    results.controller.length ||
    results.apiHelper.length ||
    results.dashboard.length ||
    results.manifest

  if (!anyRemoved) {
    console.log(`\nNo files found for feature "${name}".\n`)
    return
  }

  console.log(`\n✔ Feature "${name}" removed:\n`)
  const printGroup = (label, files) => {
    if (!files.length) return
    for (const f of files)
      console.log(`  ${label}: ${path.relative(baseDir, f)}`)
  }

  printGroup('Model', results.model)
  printGroup('Migration', results.migration)
  printGroup('Validator', results.validator)
  printGroup('Controller', results.controller)
  printGroup('API helper', results.apiHelper)
  printGroup('Dashboard', results.dashboard)
  if (results.manifest)
    console.log(`  Manifest: ${path.relative(baseDir, results.manifest)}`)

  console.log()
}
