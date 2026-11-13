import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pascalCase, detectLanguage, loadConfig, loadEnv, exists } from '@tylix/shared'
import { channelPageFiles, registerRoute, routeFile } from '../frontend/generateFiles.js'

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

  // A demo page that joins the channel: .tyx for native apps, a page in
  // the frontend's own format (plus its route) for hosted ones.
  await loadEnv(baseDir)
  const { frontend } = await loadConfig(baseDir, language)
  const native = frontend.driver === 'tylix'
  let demoPath = null
  if (native) {
    const pagesDir = path.join(baseDir, 'app', 'pages')
    await fs.mkdir(pagesDir, { recursive: true })
    const pagePath = path.join(pagesDir, `${pageName}.tyx`)
    if (await exists(pagePath)) {
      console.log(`— ${path.relative(baseDir, pagePath)} already exists, left as it is`)
    } else {
      await fs.writeFile(pagePath, rendered)
      console.log(`✔ Demo page created: ${path.relative(baseDir, pagePath)}`)
    }
    demoPath = `/${pageName.toLowerCase()}`
  } else {
    demoPath = await writeHostedDemo(baseDir, frontend.driver, pageName, channelName, isTs)
  }

  const anyType = isTs ? ': any' : ''

  const channelsPath = path.join(baseDir, 'app', `channels.${ext}`)
  if (!(await exists(channelsPath))) {
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
    demoPath
      ? `\nRun "tylix channels:work" and "tylix dev" in separate terminals, then visit ${demoPath} in two browser tabs.`
      : `\nRun "tylix channels:work" next to "tylix dev"; useChannel("${channelName}") connects to it on CHANNELS_PORT (default 6001).`,
  )
}


// Writes the hosted frontend's demo page and registers its route. Returns
// the page's path, or null when the route could not be added.
async function writeHostedDemo(baseDir, driver, pageName, channelName, ts) {
  const frontendDir = path.join(baseDir, 'app', 'frontend')
  const page = channelPageFiles(driver, pageName, channelName, { ts })
  const pagePath = path.join(frontendDir, page.file)
  const routesPath = path.join(frontendDir, routeFile(driver, ts))
  const rel = (p) => path.relative(baseDir, p)

  if (await exists(pagePath)) {
    console.log(`— ${rel(pagePath)} already exists, left as it is`)
    return page.name.routePath
  }
  await fs.mkdir(path.dirname(pagePath), { recursive: true })
  await fs.writeFile(pagePath, page.content)
  console.log(`✔ Demo page created: ${rel(pagePath)}`)

  const routes = (await exists(routesPath)) ? await fs.readFile(routesPath, 'utf-8') : null
  const result = routes ? registerRoute(routes, page) : { missing: 'route file' }
  if (result.source) {
    await fs.writeFile(routesPath, result.source)
    console.log(`✔ Route added:  ${page.name.routePath} in ${rel(routesPath)}`)
    return page.name.routePath
  }
  const reason = result.conflict ?? `${rel(routesPath)} has no "${result.missing}" marker`
  console.log(`\n  Couldn't add the route automatically: ${reason}. Add these to ${rel(routesPath)}:\n`)
  console.log(`    ${page.importLine}`)
  console.log(`    ${page.routeLine(false)}\n`)
  return null
}
