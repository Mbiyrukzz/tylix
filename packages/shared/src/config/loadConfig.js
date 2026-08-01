import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import { loadEnv } from './loadEnv.js'

const DEFAULT_CONFIG = {
  database: {
    driver: 'sqlite',
    filename: 'database.sqlite',
  },
  auth: {
    secret: 'tylix-dev-secret-change-me',
    tokenExpiresInSeconds: 60 * 60 * 24 * 7, // 7 days
  },
}

export async function loadConfig(cwd = process.cwd(), language = 'javascript') {
  const extension = language === 'typescript' ? 'ts' : 'js'
  const configPath = path.join(cwd, `tylix.config.${extension}`)

  const exists = await fs
    .access(configPath)
    .then(() => true)
    .catch(() => false)

  if (!exists) {
    return DEFAULT_CONFIG
  }

  // .env must be in process.env before tylix.config.* evaluates,
  // since the generated config now reads process.env.DATABASE_* directly.
  await loadEnv(cwd)

  const module = await import(pathToFileURL(configPath).href)
  const userConfig = module.default ?? {}

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    database: {
      ...DEFAULT_CONFIG.database,
      ...(userConfig.database ?? {}),
    },
    auth: {
      ...DEFAULT_CONFIG.auth,
      ...(userConfig.auth ?? {}),
    },
  }
}
