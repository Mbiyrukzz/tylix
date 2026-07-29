import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pascalCase } from '@tylix/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

export async function makeChannel(name) {
  const baseDir = process.cwd()
  const channelName = name.toLowerCase()
  const pageName = pascalCase(name)
  const language = await detectLanguage(baseDir)
  const ext = language === 'typescript' ? 'ts' : 'js'

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

  const pagesDir = path.join(baseDir, 'app', 'pages')
  await fs.mkdir(pagesDir, { recursive: true })
  const pagePath = path.join(pagesDir, `${pageName}.tyx`)
  await fs.writeFile(pagePath, rendered)
  console.log(`✔ Demo page created: ${path.relative(baseDir, pagePath)}`)

  const channelsPath = path.join(baseDir, 'app', `channels.${ext}`)
  const exists = await fs
    .access(channelsPath)
    .then(() => true)
    .catch(() => false)

  if (!exists) {
    await fs.writeFile(
      channelsPath,
      `export async function channels(server) {\n  server.channel("${channelName}", {\n    onConnect(client) {},\n    onMessage(client, data) {\n      server.broadcast("${channelName}", data)\n    },\n    onDisconnect(client) {},\n  })\n}\n`,
    )
    console.log(
      `✔ app/channels.js created with "${channelName}" channel registered`,
    )
  } else {
    const existing = await fs.readFile(channelsPath, 'utf-8')
    if (existing.includes(`server.channel("${channelName}"`)) {
      console.log(
        `— Channel "${channelName}" already registered in app/channels.js, skipped`,
      )
    } else {
      console.log(
        `\nHeads up: app/channels.js already exists and wasn't modified.\n` +
          `Add this inside your "channels(server)" function to wire up "${channelName}":\n\n` +
          `  server.channel("${channelName}", {\n` +
          `    onConnect(client) {},\n` +
          `    onMessage(client, data) {\n` +
          `      server.broadcast("${channelName}", data)\n` +
          `    },\n` +
          `    onDisconnect(client) {},\n` +
          `  })\n`,
      )
    }
  }

  console.log(
    `\nRun "tylix channels:work" and "tylix dev" in separate terminals, then visit /${pageName.toLowerCase()} in two browser tabs.`,
  )
}
