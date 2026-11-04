import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Blueprint,
  FeatureGenerator,
  DashboardGenerator,
  RouteGenerator,
} from '@tylix/generator'
import { detectLanguage } from '@tylix/shared'

// First line of every route file written by make:feature.
const FEATURE_ROUTE_MARKER = '// @tylix-feature'

async function ensurePackageJson(baseDir) {
  const pkgPath = path.join(baseDir, 'package.json')
  const exists = await fs
    .access(pkgPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    await fs.writeFile(
      pkgPath,
      JSON.stringify(
        { name: 'tylix-app', version: '0.1.0', type: 'module' },
        null,
        2,
      ),
    )
  }
}

// --public           -> every action is open (no login)
// --public=store,index -> login required except for those actions
function extractPublicFlag(fieldArgs) {
  const flag = fieldArgs.find(
    (a) => a === '--public' || a.startsWith('--public='),
  )
  const rest = fieldArgs.filter((a) => a !== flag)

  if (!flag) return { rest, publicAll: false, publicActions: [] }
  if (flag === '--public') return { rest, publicAll: true, publicActions: [] }

  const publicActions = flag
    .slice('--public='.length)
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
  return { rest, publicAll: false, publicActions }
}

// True when a route file exists at `filePath` but make:feature did not
// write it (no marker). Such a file is kept as is, and any route in it
// on the same method and path as a feature route wins, because the
// router answers with the first match.
async function isForeignRouteFile(filePath) {
  let content
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return false
  }
  return !content.includes(FEATURE_ROUTE_MARKER)
}

export async function makeFeature(
  name,
  fieldArgs = [],
  { dashboard = false } = {},
) {
  const blueprint = new Blueprint(name)

  // Table name exactly as typed (lowercased, never pluralized):
  // "abc" -> abc, "abcs" -> abcs
  blueprint.table(name.toLowerCase())

  const { rest, publicAll, publicActions } = extractPublicFlag(fieldArgs)

  for (const arg of rest) {
    const [fieldName, fieldType = 'string', third] = arg.split(':')

    if (fieldType === 'belongsTo') {
      blueprint.belongsTo(fieldName)
      continue
    }

    if (fieldType === 'hasMany') {
      // syntax: comments:hasMany:Comment  -> third segment is the target model
      blueprint.hasMany(third || fieldName)
      continue
    }

    const options = {}
    if (third === 'unique') options.unique = true
    if (third === 'system') options.system = true
    blueprint.field(fieldName, fieldType, options)
  }

  blueprint.timestamps().api().crud()
  if (dashboard) blueprint.dashboard()
  if (publicAll) blueprint.public()
  else if (publicActions.length > 0) blueprint.public(publicActions)

  const baseDir = process.cwd()
  await ensurePackageJson(baseDir)

  const generator = new FeatureGenerator()
  const results = await generator.generate(blueprint, baseDir)

  // Visible route file in app/routes/, same place make:api writes to.
  const language = await detectLanguage(baseDir)
  const routeFile = await new RouteGenerator().generate(
    blueprint,
    baseDir,
    language,
  )

  console.log(`\n✔ Feature "${blueprint.name}" created:\n`)
  console.log(`  Model:      ${path.relative(baseDir, results.model)}`)
  console.log(`  Migration:  ${path.relative(baseDir, results.migration)}`)
  console.log(`  Validator:  ${path.relative(baseDir, results.validator)}`)
  console.log(`  Controller: ${path.relative(baseDir, results.controller)}`)
  console.log(
    `  Routes:     ${
      routeFile
        ? path.relative(baseDir, routeFile)
        : 'already exists, not overwritten'
    }`,
  )
  console.log(`  Manifest:   ${path.relative(baseDir, results.manifest)}`)

  if (blueprint.options.dashboard) {
    const dashGen = new DashboardGenerator()
    const dashPath = await dashGen.generate(blueprint, baseDir)
    console.log(`  Dashboard:  ${path.relative(baseDir, dashPath)}`)
  }

  const access = !blueprint.options.auth
    ? 'public (no login required)'
    : blueprint.options.publicActions.length > 0
      ? `login required, except: ${blueprint.options.publicActions.join(', ')}`
      : 'login required'
  console.log(`\n  Access:     ${access}\n`)

  // The route file was kept, but make:feature did not write it. Its
  // routes are mounted first, so anything it already defines on the same
  // method and path hides the feature's own action.
  if (!routeFile) {
    const ext = language === 'typescript' ? 'ts' : 'js'
    const existing = path.join(
      baseDir,
      'app',
      'routes',
      `${blueprint.tableName}.${ext}`,
    )
    if (await isForeignRouteFile(existing)) {
      console.log(
        `⚠ ${path.relative(baseDir, existing)} was not written by make:feature (for example, by make:api).\n` +
          `  The feature's CRUD routes are still mounted, but any route in that file on the same\n` +
          `  method and path is reached first, and the feature's action is never called.\n` +
          `  Delete or rename that file if you want the generated routes.\n`,
      )
    }
  }
}