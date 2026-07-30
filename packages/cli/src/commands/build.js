import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { detectLanguage, loadEnv, loadConfig } from '@tylix/shared'

const execFileAsync = promisify(execFile)

async function pathExists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

async function walkPagesDir(dir) {
  const exists = await pathExists(dir)
  if (!exists) return []
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

// `tylix build` is a pre-flight gate for production, not a bundler --
// pages are rendered per-request against a live database/auth/feature
// backend (see registerPageRoutes in dev.js), so there's no static
// HTML to emit the way a static-site generator would. What build DOES
// do: typecheck every .tyx page up front, catching errors before a
// real user hits that route, instead of discovering them one request
// at a time in production the way `tylix dev` currently does lazily.
// It also produces a minified production CSS bundle, since dev's own
// buildTailwindCss() never passes --minify.
export async function build() {
  const baseDir = process.cwd()
  await loadEnv(baseDir)
  await loadConfig(baseDir)

  const language = await detectLanguage(baseDir)
  const { typecheckPage } = await import('@tylix/compiler')

  console.log('Tylix Build')
  console.log('─'.repeat(28))

  let hadErrors = false

  if (language === 'typescript') {
    const pagesDir = path.join(baseDir, 'app', 'pages')
    const files = await walkPagesDir(pagesDir)
    console.log(`\nTypechecking ${files.length} page(s)...`)
    for (const filePath of files) {
      const source = await fs.readFile(filePath, 'utf-8')
      const diagnostics = typecheckPage(source)
      if (diagnostics.length > 0) {
        hadErrors = true
        console.log(`\n✘ ${path.relative(baseDir, filePath)}`)
        for (const d of diagnostics) {
          console.log(`  Line ${d.line}: ${d.message}`)
        }
      }
    }
    if (!hadErrors) console.log('✔ No type errors found.')
  }

  const binPath = path.join(baseDir, 'node_modules', '.bin', 'tailwindcss')
  const inputPath = path.join(baseDir, 'app', 'tailwind-input.css')
  const outputPath = path.join(baseDir, 'public', 'tailwind.css')
  if ((await pathExists(binPath)) && (await pathExists(inputPath))) {
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
    } catch (err) {
      hadErrors = true
      console.log(`✘ Tailwind build failed: ${err.message}`)
    }
  }

  console.log()
  if (hadErrors) {
    console.log('Build failed — fix the errors above before deploying.')
    process.exitCode = 1
  } else {
    console.log('Build passed. Ready to deploy.')
  }
}
