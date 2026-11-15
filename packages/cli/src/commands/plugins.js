import { detectLanguage, loadConfig, loadEnv } from '@tylix/shared'
import { preparePlugins } from '../server/plugins.js'

async function projectPlugins() {
  const baseDir = process.cwd()
  await loadEnv(baseDir)
  const config = await loadConfig(baseDir, await detectLanguage(baseDir))
  const host = await preparePlugins(baseDir, config)
  return { baseDir, config, host }
}

// tylix plugins: what each plugin adds.
export async function listPlugins() {
  const { host } = await projectPlugins()
  const plugins = host.describe()
  if (plugins.length === 0) {
    console.log('No plugins. Add them to plugins: [...] in tylix.config, or put files in app/plugins/.')
    return
  }
  console.log(`${plugins.length} plugin(s):\n`)
  for (const p of plugins) {
    console.log(`  ${p.name}  \x1b[90m(${p.source})\x1b[0m`)
    const parts = [
      p.hooks.length && `hooks: ${p.hooks.join(', ')}`,
      p.commands.length && `commands: ${p.commands.join(', ')}`,
      p.logDrivers.length && `log drivers: ${p.logDrivers.join(', ')}`,
      p.deployAdapters.length && `deploy adapters: ${p.deployAdapters.join(', ')}`,
    ].filter(Boolean)
    for (const part of parts) console.log(`    ${part}`)
  }
}

// Runs a command a plugin defines. Returns false when no plugin has it.
export async function runPluginCommand(command, args) {
  let project
  try {
    project = await projectPlugins()
  } catch {
    return false // not in a Tylix project, or the config doesn't load
  }
  const commands = project.host.collect('commands')
  const found = commands.get(command)
  if (!found) return { available: [...commands.keys()] }
  await found.value.run(args, { baseDir: project.baseDir, config: project.config })
  return true
}
