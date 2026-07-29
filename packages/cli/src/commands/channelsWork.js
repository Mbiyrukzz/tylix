import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ChannelServer } from '@tylix/core'
import { loadEnv, detectLanguage } from '@tylix/shared'

export async function channelsWork() {
  const baseDir = process.cwd()
  await loadEnv(baseDir) // for CHANNELS_PORT, if set

  const port = Number(process.env.CHANNELS_PORT) || 6001
  const language = await detectLanguage(baseDir)
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

  const server = new ChannelServer()
  await mod.channels(server)
  server.listen(port)

  console.log(`Channel server running on ws://localhost:${port}\n`)
}
