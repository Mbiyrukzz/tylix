import fs from 'node:fs/promises'
import path from 'node:path'

function buildMailBlock() {
  return `
  mail: {
    driver: process.env.MAIL_DRIVER || 'log',
    from: process.env.MAIL_FROM || 'noreply@example.com',
    host: process.env.MAIL_HOST || '',
    port: Number(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USER || '',
    password: process.env.MAIL_PASSWORD || '',
    secure: process.env.MAIL_SECURE === 'true',
  },`
}

export async function writeMailConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const isTs = config.language === 'typescript'
  const ext = isTs ? 'ts' : 'js'

  const configPath = path.join(targetDir, `tylix.config.${ext}`)
  const existing = await fs.readFile(configPath, 'utf-8')

  // writeDatabaseConfig always writes a file ending in exactly
  // "\n};\n" (every branch of buildTylixConfigContent does), so this
  // patches the mail block in right before that closing brace rather
  // than owning the whole file.
  const updated = existing.replace(/\n};\n$/, `${buildMailBlock()}\n};\n`)

  await fs.writeFile(configPath, updated)
}
