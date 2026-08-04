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
    tokenExpiresInSeconds: 60 * 60 * 24 * 7,
  },
  mail: {
    driver: 'log',
    from: 'noreply@example.com',
    host: '',
    port: 587,
    user: '',
    password: '',
    secure: false,
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
    // Check for the other extension too, so a JS/TS mismatch (the
    // most common real cause of this) gets a specific, actionable
    // warning instead of just "not found".
    const otherExtension = extension === 'ts' ? 'js' : 'ts'
    const otherPath = path.join(cwd, `tylix.config.${otherExtension}`)
    const otherExists = await fs
      .access(otherPath)
      .then(() => true)
      .catch(() => false)

    if (otherExists) {
      console.warn(
        `⚠ Expected tylix.config.${extension} (project detected as ${language}), ` +
          `but found tylix.config.${otherExtension} instead. ` +
          `Using default config — rename the file to match, or it will keep being ignored.`,
      )
    } else {
      console.warn(
        `⚠ No tylix.config.${extension} found at ${cwd}. Using default config ` +
          `(sqlite / log-driver mail / dev auth secret) — this is probably not what you want in a real project.`,
      )
    }
    return DEFAULT_CONFIG
  }

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
    mail: {
      ...DEFAULT_CONFIG.mail,
      ...(userConfig.mail ?? {}),
    },
  }
}
