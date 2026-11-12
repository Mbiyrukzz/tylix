import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pascalCase, detectLanguage, loadConfig, loadEnv } from '@tylix/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

export async function makeChannel(name) {
  const baseDir = process.cwd()
  const channelName = name.toLowerCase()
  const pageName = pascalCase(name)
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'
  const isTs = language === 'typescript'

  const templatePath = path.join(
    PACKAGE_ROOT,
    'src',
    'templates',
    'channel-demo-page.tyx.template',
  )
  const template = await fs.readFile(templatePath, 'utf-8')
  const rendered = template
    .replaceAll('{{PageName}}', pageName)
    .replaceAll('{{channelName}}', channelName)

  // The demo page is a .tyx page, so only native apps get one.
  await loadEnv(baseDir)
  const { frontend } = await loadConfig(baseDir, language)
  const native = frontend.driver === 'tylix'
  if (native) {
    const pagesDir = path.join(baseDir, 'app', 'pages')
    await fs.mkdir(pagesDir, { recursive: true })
    const pagePath = path.join(pagesDir, `${pageName}.tyx`)
    const pageExists = await fs.access(pagePath).then(() => true, () => false)
    if (pageExists) {
      console.log(`— ${path.relative(baseDir, pagePath)} already exists, left as it is`)
    } else {
      await fs.writeFile(pagePath, rendered)
      console.log(`✔ Demo page created: ${path.relative(baseDir, pagePath)}`)
    }
  }

  const anyType = isTs ? ': any' : ''

  const channelsPath = path.join(baseDir, 'app', `channels.${ext}`)
  const exists = await fs
    .access(channelsPath)
    .then(() => true)
    .catch(() => false)

  if (!exists) {
    await fs.writeFile(
      channelsPath,
      `export async function channels(server${anyType}) {\n  server.channel("${channelName}", {\n    onConnect(client${anyType}) {},\n    onMessage(client${anyType}, data${anyType}) {\n      server.broadcast("${channelName}", data)\n    },\n    onDisconnect(client${anyType}) {},\n  })\n}\n`,
    )
    console.log(
      `✔ app/channels.${ext} created with "${channelName}" channel registered`,
    )
  } else {
    const existing = await fs.readFile(channelsPath, 'utf-8')
    if (existing.includes(`server.channel("${channelName}"`)) {
      console.log(
        `— Channel "${channelName}" already registered in app/channels.${ext}, skipped`,
      )
    } else {
      console.log(
        `\nHeads up: app/channels.${ext} already exists and wasn't modified.\n` +
          `Add this inside your "channels(server)" function to wire up "${channelName}":\n\n` +
          `  server.channel("${channelName}", {\n` +
          `    onConnect(client${anyType}) {},\n` +
          `    onMessage(client${anyType}, data${anyType}) {\n` +
          `      server.broadcast("${channelName}", data)\n` +
          `    },\n` +
          `    onDisconnect(client${anyType}) {},\n` +
          `  })\n`,
      )
    }
  }

  console.log(
    native
      ? `\nRun "tylix channels:work" and "tylix dev" in separate terminals, then visit /${pageName.toLowerCase()} in two browser tabs.`
      : `\nRun "tylix channels:work" next to "tylix dev". Your ${frontend.driver} app connects to the channel server with a WebSocket on CHANNELS_PORT (default 6001).`,
  )
}