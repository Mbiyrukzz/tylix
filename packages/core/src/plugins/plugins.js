import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Plugins add to an app without editing it: routes, middleware, log
// drivers, CLI commands, deployment adapters, config changes.
//
//   // tylix.config
//   import sentry from '@acme/tylix-sentry'
//   export default defineConfig({
//     plugins: [
//       sentry({ dsn: process.env.SENTRY_DSN }),     // an object or factory result
//       '@acme/tylix-audit',                          // a package (default export)
//       ['./plugins/banner.js', { text: 'Hi' }],      // a file, with options
//     ],
//   })
//
// Files in app/plugins/ are loaded too, in name order (skip one with a
// leading underscore).
//
//   import { definePlugin } from '@tylix/core'
//   export default definePlugin({
//     name: 'audit',
//     config(config) { return { observability: { ...config.observability, slowRequestMs: 500 } } },
//     register({ use, logger }) { use((req, res, next) => { ...; return next() }) },
//     routes(router, { auth }) { router.get('/api/audit', auth(handler)) },
//     boot(app) {},
//     close() {},
//     logDrivers: { slack: (config) => ({ write(entry) {} }) },
//     commands: { 'audit:prune': { description: 'Delete old rows', run(args, ctx) {} } },
//     deployAdapters: { fly: { name: 'fly', label: 'Fly.io', files(ctx) { return { 'fly.toml': '...' } } } },
//   })

export const PLUGIN_HOOKS = ['config', 'register', 'routes', 'boot', 'close']

export function definePlugin(plugin) {
  return plugin
}

const PLUGIN_FILE = /\.(js|mjs|ts)$/
const SKIP_FILE = /(\.d\.ts$|\.test\.(js|ts)$|^_|^\.)/

async function importSpecifier(baseDir, specifier) {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    return import(pathToFileURL(path.resolve(baseDir, specifier)).href)
  }
  // A package, resolved from the project (not from @tylix/core).
  const require = createRequire(path.join(baseDir, 'package.json'))
  let resolved
  try {
    resolved = require.resolve(specifier)
  } catch {
    throw new Error(`Plugin "${specifier}" is not installed. Run: npm install ${specifier}`)
  }
  return import(pathToFileURL(resolved).href)
}

// A module's plugin: its default export, or an export named "plugin".
// A function is a factory and gets the options.
function fromModule(mod, options, source) {
  const value = mod?.default ?? mod?.plugin
  if (value === undefined) throw new Error(`${source} has no default export (the plugin).`)
  return typeof value === 'function' ? value(options ?? {}) : value
}

function normalize(plugin, source, index) {
  if (!plugin || typeof plugin !== 'object') throw new Error(`Plugin ${source} must be an object, got ${typeof plugin}.`)
  for (const hook of PLUGIN_HOOKS) {
    if (plugin[hook] !== undefined && typeof plugin[hook] !== 'function') throw new Error(`Plugin ${plugin.name ?? source}: ${hook} must be a function.`)
  }
  const name = plugin.name ?? (typeof source === 'string' ? path.basename(source).replace(PLUGIN_FILE, '') : `plugin-${index + 1}`)
  return { ...plugin, name, source }
}

// Resolves config.plugins and app/plugins/* into plugin objects, in that
// order. Throws with the plugin's name when one can't be loaded.
export async function loadPlugins(baseDir, config = {}) {
  const loaded = []
  const entries = config.plugins ?? []
  if (!Array.isArray(entries)) throw new Error('tylix.config: plugins must be a list.')

  for (const [index, entry] of entries.entries()) {
    if (!entry) continue // allows plugins: [isProd && plugin()]
    let plugin
    let source = 'tylix.config'
    if (typeof entry === 'string' || Array.isArray(entry)) {
      const [specifier, options] = Array.isArray(entry) ? entry : [entry]
      source = specifier
      plugin = fromModule(await importSpecifier(baseDir, specifier), options, specifier)
    } else if (typeof entry === 'function') {
      plugin = entry({})
    } else {
      plugin = entry
    }
    loaded.push(normalize(await plugin, source, index))
  }

  const dir = path.join(baseDir, 'app', 'plugins')
  const files = await fs.readdir(dir).catch(() => [])
  for (const name of files.sort()) {
    if (!PLUGIN_FILE.test(name) || SKIP_FILE.test(name)) continue
    const rel = `app/plugins/${name}`
    const plugin = fromModule(await import(pathToFileURL(path.join(dir, name)).href), {}, rel)
    loaded.push(normalize(await plugin, rel, loaded.length))
  }

  const seen = new Set()
  for (const plugin of loaded) {
    if (seen.has(plugin.name)) throw new Error(`Two plugins are named "${plugin.name}". Give one a different name.`)
    seen.add(plugin.name)
  }
  return loaded
}

function labelled(plugin, hook, err) {
  err.message = `Plugin "${plugin.name}" ${hook}() failed: ${err.message}`
  return err
}

// Runs plugin hooks in order. One per app.
export function createPluginHost(plugins = []) {
  return {
    plugins,

    // Each config() may change the config in place or return keys to
    // merge into it (top level, shallow).
    async applyConfig(config) {
      for (const plugin of plugins) {
        if (!plugin.config) continue
        try {
          const next = await plugin.config(config)
          if (next && typeof next === 'object' && next !== config) Object.assign(config, next)
        } catch (err) {
          throw labelled(plugin, 'config', err)
        }
      }
      return config
    },

    async run(hook, ...args) {
      for (const plugin of plugins) {
        if (typeof plugin[hook] !== 'function') continue
        try {
          await plugin[hook](...args)
        } catch (err) {
          throw labelled(plugin, hook, err)
        }
      }
    },

    // Runs a hook with a context made for each plugin.
    async runWith(hook, makeArgs) {
      for (const plugin of plugins) {
        if (typeof plugin[hook] !== 'function') continue
        try {
          await plugin[hook](...makeArgs(plugin))
        } catch (err) {
          throw labelled(plugin, hook, err)
        }
      }
    },

    // close() hooks run in reverse order and never throw.
    async close() {
      for (const plugin of [...plugins].reverse()) {
        try {
          await plugin.close?.()
        } catch {
          // shutting down: nothing to do about it
        }
      }
    },

    // Collects a keyed property (commands, logDrivers, deployAdapters)
    // from every plugin. A later plugin can't silently replace an earlier
    // one's key.
    collect(property) {
      const out = new Map()
      for (const plugin of plugins) {
        for (const [key, value] of Object.entries(plugin[property] ?? {})) {
          if (out.has(key)) throw new Error(`Plugins "${out.get(key).plugin}" and "${plugin.name}" both define ${property} "${key}".`)
          out.set(key, { plugin: plugin.name, value })
        }
      }
      return out
    },

    describe() {
      return plugins.map((plugin) => ({
        name: plugin.name,
        source: plugin.source,
        hooks: PLUGIN_HOOKS.filter((hook) => typeof plugin[hook] === 'function'),
        commands: Object.keys(plugin.commands ?? {}),
        logDrivers: Object.keys(plugin.logDrivers ?? {}),
        deployAdapters: Object.keys(plugin.deployAdapters ?? {}),
      }))
    },
  }
}
