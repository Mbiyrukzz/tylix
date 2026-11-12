import fs from 'node:fs/promises'
import path from 'node:path'

// Project options, in the spirit of vite.config. Anything that changes
// between machines or is secret (the database connection, the auth secret,
// mail credentials) lives in .env and is not repeated here. Values set in
// .env take priority over this file.
const frontendBlock = (driver, label, { ssr = false } = {}) => `  // Pages are a ${label} app in app/frontend, served through Vite. Remove
  // this block (or set driver: "tylix") for native .tyx pages.
  frontend: {
    driver: "${driver}",${
      ssr
        ? `
    // Server-side rendering: pages arrive as HTML with their data, then
    // hydrate (app/frontend/entry-server). false = client rendering only.
    ssr: true,`
        : ''
    }
    // Guests asking for these are redirected to /login?next=... by the
    // server, before any HTML is sent. "/x/**" means /x and everything
    // below it. The API stays protected by requireAuth either way.
    protected: ["/dashboard/**"],
  },
`

const FRONTEND_BLOCK = {
  react: frontendBlock('react', 'React', { ssr: true }),
  svelte: frontendBlock('svelte', 'Svelte', { ssr: true }),
  vue: frontendBlock('vue', 'Vue', { ssr: true }),
  angular: frontendBlock('angular', 'Angular', { ssr: true }),
}

// defineConfig only types the object (editor autocompletion and checks);
// loadConfig validates it again when the app starts.
const TYLIX_CONFIG = `import { defineConfig } from "@tylix/shared";

export default defineConfig({
__FRONTEND__  auth: {
    // How long a login stays valid, in seconds (7 days).
    tokenExpiresInSeconds: 60 * 60 * 24 * 7,
  },
});
`

export async function writeDatabaseConfig(config) {
  const targetDir = path.join(process.cwd(), config.projectName)
  const ext = config.language === 'typescript' ? 'ts' : 'js'
  const frontend = FRONTEND_BLOCK[config.frontend] ?? ''
  await fs.writeFile(
    path.join(targetDir, `tylix.config.${ext}`),
    TYLIX_CONFIG.replace('__FRONTEND__', frontend),
  )
}