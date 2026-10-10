import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { detectLanguage, loadEnv, loadConfig } from '@tylix/shared'

const execFileAsync = promisify(execFile)

const DEV_AUTH_SECRET = 'tylix-dev-secret-change-me'

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

async function walkPagesDir(dir) {
  if (!(await pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'components') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkPagesDir(fullPath)))
    } else if (entry.name.endsWith('.tyx') && entry.name !== '_layout.tyx') {
      files.push(fullPath)
    }
  }
  return files
}

// Same source dev.js feeds typecheckPage as its second argument, so
// pages that call generated API helpers (useApi) typecheck the same
// way in build as they do in dev. Kept in sync with dev.js's
// loadApiHelpersForTypecheck -- worth moving into a shared util.
async function loadApiHelpersForTypecheck(baseDir) {
  const apiDir = path.join(baseDir, 'app', 'useApi')
  if (!(await pathExists(apiDir))) return ''

  const entries = await fs.readdir(apiDir, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      const raw = await fs.readFile(path.join(apiDir, entry.name), 'utf-8')
      sources.push(
        raw.replace(/^import\s+.*$/gm, '').replace(/export\s+/g, ''),
      )
    }
  }
  return sources.join('\n\n')
}

// Returns true if the config check passed.
async function checkConfig(baseDir, language, isProduction) {
  const ext = language === 'typescript' ? 'ts' : 'js'
  console.log('\nChecking configuration...')

  let config
  try {
    config = await loadConfig(baseDir, language)
  } catch (err) {
    console.log(`✘ Could not load tylix.config.${ext}: ${err.message}`)
    return false
  }

  const secret = config?.auth?.secret
  if (!secret || secret === DEV_AUTH_SECRET) {
    const message = !secret
      ? 'auth.secret is empty -- set AUTH_SECRET in the environment.'
      : 'auth.secret is the public default dev secret -- set AUTH_SECRET.'
    if (isProduction) {
      console.log(`✘ ${message}`)
      return false
    }
    console.log(`⚠ ${message} (this fails the build when NODE_ENV=production)`)
    return true
  }

  console.log('✔ Configuration loaded.')
  return true
}

// Returns true if every page passed.
async function typecheckPages(baseDir) {
  const { typecheckPage, extractImports } = await import('@tylix/compiler')

  const pagesDir = path.join(baseDir, 'app', 'pages')
  const files = await walkPagesDir(pagesDir)
  const apiHelpersSource = await loadApiHelpersForTypecheck(baseDir)

  console.log(`\nTypechecking ${files.length} page(s)...`)

  let failed = 0
  for (const filePath of files) {
    const rel = path.relative(baseDir, filePath)
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      // Import lines never reach the parser -- strip them first,
      // exactly like dev does before compiling a page.
      const { source } = extractImports(raw)
      const diagnostics = typecheckPage(source, apiHelpersSource)
      if (diagnostics.length > 0) {
        failed++
        console.log(`\n✘ ${rel}`)
        for (const d of diagnostics) {
          console.log(`  Line ${d.line}: ${d.message}`)
        }
      }
    } catch (err) {
      // Parse/lex errors throw instead of returning diagnostics.
      // Report them per page so one bad file doesn't hide the rest.
      failed++
      console.log(`\n✘ ${rel}`)
      console.log(`  ${err.message}`)
    }
  }

  if (failed === 0) {
    console.log('✔ No type errors found.')
    return true
  }
  console.log(`\n${failed} of ${files.length} page(s) failed.`)
  return false
}

// Returns true if CSS built (or there was nothing to build).
async function buildCss(baseDir) {
  const binPath = path.join(baseDir, 'node_modules', '.bin', 'tailwindcss')
  const inputPath = path.join(baseDir, 'app', 'tailwind-input.css')
  const outputPath = path.join(baseDir, 'public', 'tailwind.css')

  if (!(await pathExists(binPath)) || !(await pathExists(inputPath))) {
    return true
  }

  console.log('\nBuilding production CSS...')
  try {
    await execFileAsync(binPath, [
      '-i',
      inputPath,
      '-o',
      outputPath,
      '--minify',
    ])
    console.log('✔ Tailwind CSS built and minified.')
    return true
  } catch (err) {
    console.log(`✘ Tailwind build failed: ${err.message}`)
    return false
  }
}

// `tylix build` is a pre-flight gate for production, not a bundler --
// pages are rendered per request against a live database/auth/feature
// backend, so there's no static HTML to emit. It checks the config,
// typechecks every page up front, and produces a minified CSS bundle.
// Exits non-zero on any failure so CI and deploy tooling can stop a
// bad release.
export async function build() {
  const baseDir = process.cwd()
  const isProduction = process.env.NODE_ENV === 'production'

  await loadEnv(baseDir)
  const language = await detectLanguage(baseDir)

  console.log('Tylix Build')
  console.log('─'.repeat(28))

  const results = []
  results.push(await checkConfig(baseDir, language, isProduction))

  if (language === 'typescript') {
    results.push(await typecheckPages(baseDir))
  }

  results.push(await buildCss(baseDir))

  console.log()
  if (results.includes(false)) {
    console.log('Build failed — fix the errors above before deploying.')
    process.exitCode = 1
  } else {
    console.log('Build passed. Ready to deploy.')
  }
}