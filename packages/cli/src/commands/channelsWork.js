import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ChannelServer } from '@tylix/core'
import { loadConfig, detectLanguage } from '@tylix/shared'
import { bootstrapDatabase } from '../bootstrap.js'
import { openStore } from '../server/store.js'

export async function channelsWork() {
  const baseDir = process.cwd()
  const language = await detectLanguage(baseDir)
  // CHANNELS_PORT (.env) or channels.port (tylix.config), default 6001.
  const config = await loadConfig(baseDir, language)
  const port = config.channels.port
  const ext = language === 'typescript' ? 'ts' : 'js'
  const channelsPath = path.join(baseDir, 'app', `channels.${ext}`)

  const exists = await fs
    .access(channelsPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    console.error(
      `No app/channels.${ext} found at ${channelsPath}. Create one exporting an async "channels(server)" function.`,
    )
    process.exit(1)
  }

  const mod = await import(pathToFileURL(channelsPath).href)
  if (typeof mod.channels !== 'function') {
    console.error(
      `app/channels.${ext} must export an async function named "channels(server)".`,
    )
    process.exit(1)
  }

  // broadcast() calls from the app (and other channel servers) arrive
  // through the store; the database driver needs the database.
  if (config.store.driver === 'database') await bootstrapDatabase(baseDir)
  const store = await openStore(config, { role: 'channels' })

  const server = new ChannelServer()
  await mod.channels(server)
  await server.connectStore(store)
  server.listen(port)

  console.log(`Channel server running on ws://localhost:${port} (store: ${store.driver})\n`)
}
