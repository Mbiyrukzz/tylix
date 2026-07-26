// packages/cli/src/commands/tinker.js
import repl from 'node:repl'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { bootstrapDatabase } from '../bootstrap.js'
import { migrate } from './migrate.js'
import { cache } from '../../../core/src/index.js'

export async function tinker() {
  const baseDir = process.cwd()
  await bootstrapDatabase()

  const modelsDir = path.join(baseDir, 'app', 'models')
  const context = { migrate, seed, cache }

  const exists = await fs
    .access(modelsDir)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    const files = (await fs.readdir(modelsDir)).filter((f) => f.endsWith('.js'))
    for (const file of files) {
      const exportName = file.replace(/\.js$/, '')
      const mod = await import(pathToFileURL(path.join(modelsDir, file)).href)
      if (mod[exportName]) context[exportName] = mod[exportName]
    }
  }

  console.log(
    `Tylix Tinker — models loaded: ${
      Object.keys(context)
        .filter((k) => k !== 'migrate')
        .join(', ') || '(none found in app/models)'
    }\n`,
  )
  console.log('Try: await Post.all(), await migrate()\n')

  const replServer = repl.start({ prompt: 'tylix> ', useGlobal: false })
  Object.assign(replServer.context, context)

  replServer.on('exit', () => process.exit(0))
}
