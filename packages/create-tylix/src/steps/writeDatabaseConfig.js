import fs from 'node:fs/promises'
import path from 'node:path'

// Project options, in the spirit of vite.config. Anything that changes
// between machines or is secret (the database connection, the auth secret,
// mail credentials) lives in .env and is not repeated here. Values set in
// .env take priority over this file.
const TYLIX_CONFIG = `export default {
  auth: {
    // How long a login stays valid, in seconds (7 days).
    tokenExpiresInSeconds: 60 * 60 * 24 * 7,
  },
};
`

export async function writeDatabaseConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const ext = config.language === 'typescript' ? 'ts' : 'js'
  await fs.writeFile(path.join(targetDir, `tylix.config.${ext}`), TYLIX_CONFIG)
}