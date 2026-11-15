// Loads the app's plugins (tylix.config plugins and app/plugins/*) and
// applies what they change before anything else reads the config: their
// config() hooks and their log drivers.
import { Log, createPluginHost, loadPlugins } from '@tylix/core'

export async function preparePlugins(baseDir, config) {
  const host = createPluginHost(await loadPlugins(baseDir, config))
  await host.applyConfig(config)
  for (const [driver, { value }] of host.collect('logDrivers')) Log.extend(driver, value)
  return host
}
