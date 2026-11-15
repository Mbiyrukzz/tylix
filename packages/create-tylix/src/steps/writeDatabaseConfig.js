import fs from 'node:fs/promises'
import path from 'node:path'

// Project options, in the spirit of vite.config. Anything that changes
// between machines or is secret (the database connection, the auth secret,
// mail credentials) lives in .env and is not repeated here. Values set in
// .env take priority over this file.
const frontendBlock = (driver, label, { ssr = false } = {}) => `  // Pages are a ${label} app in app/views, served through Vite. Remove
  // this block (or set driver: "tylix") for native .tyx pages.
  frontend: {
    driver: "${driver}",${
      ssr
        ? `
    // Server-side rendering: pages arrive as HTML with their data, then
    // hydrate (app/views/entry-server). false = client rendering only.
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
    // Lifetime of an access token, in seconds. Kept short on purpose: the
    // refresh session (rotated on every use, 30 days) keeps people signed
    // in, and ending it (logout, password reset) applies at once.
    tokenExpiresInSeconds: 15 * 60,
    // Refuse passwords found in public data breaches (Have I Been Pwned).
    checkBreachedPasswords: false,
  },
  logging: {
    // LOG_CHANNEL picks the channel; "stack" writes to every channel in
    // LOG_STACK (default console,daily). Daily files are kept in
    // storage/logs for LOG_DAILY_DAYS (14) days. Use them with
    // Log.info(...), Log.channel("name").error(...) from @tylix/core.
    channels: {
      // payments: { driver: "daily", path: "storage/logs/payments.log", level: "warning" },
    },
  },
  queue: {
    // Defaults for every job; a job can set its own tries/backoff/timeout.
    tries: 3,
    backoff: "exponential",
  },
  // Plugins: packages, files, or plugin objects. Files in app/plugins/
  // are loaded too.
  plugins: [],
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