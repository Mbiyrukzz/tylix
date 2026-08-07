import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

// Written on every scaffold, regardless of auth -- these have no
// dependency on a signed-in user, so gating them behind authEnabled
// would mean a no-auth project's Dashboard.tyx has no working example
// of `uses`/`background` at all.
const ALWAYS_CAPABILITY_TEMPLATES = {
  Theme: 'theme-capability.tyx.template',
  Mail: 'mail-capability.tyx.template',
  Analytics: 'analytics-capability.tyx.template',
}

// Only written when authEnabled -- these represent user-owned/scoped
// app data (posts, the user list, per-user notifications), so without
// Auth there's no "current user" for them to be scoped to.
const AUTH_CAPABILITY_TEMPLATES = {
  Auth: 'auth-capability.tyx.template',
  Posts: 'posts-capability.tyx.template',
  Users: 'users-capability.tyx.template',
  Notifications: 'notifications-capability.tyx.template',
}

export async function writeCapabilities(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const capabilitiesDir = path.join(targetDir, 'app', 'capabilities')
  await fs.mkdir(capabilitiesDir, { recursive: true })

  const templates = {
    ...ALWAYS_CAPABILITY_TEMPLATES,
    ...(config.authEnabled ? AUTH_CAPABILITY_TEMPLATES : {}),
  }

  const written = []
  for (const [name, templateName] of Object.entries(templates)) {
    const content = await fs.readFile(
      path.join(PACKAGE_ROOT, 'src', 'templates', templateName),
      'utf-8',
    )
    const outputPath = path.join(capabilitiesDir, `${name}.tyx`)
    await fs.writeFile(outputPath, content)
    written.push(outputPath)
  }
  return written
}
