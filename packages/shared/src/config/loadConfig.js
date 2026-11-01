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

// Reads one variable from the environment. An empty value counts as unset,
// so a blank line such as "MAIL_HOST=" never overrides a default.
function env(name) {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function toNumber(value) {
  if (value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function toBoolean(value) {
  if (value === undefined) return undefined
  return value === 'true' || value === '1'
}

// Drops keys whose value is undefined, so they never overwrite a default.
// This also protects projects whose config file still contains
// "secret: process.env.AUTH_SECRET" while that variable is unset.
function defined(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  )
}

// Connection defaults per driver, used when neither the config file nor
// .env sets a value. The database name defaults to the project folder name,
// which is what the scaffolder uses.
function driverDefaults(driver, cwd) {
  const name = path.basename(cwd)
  switch (driver) {
    case 'sqlite':
      return { filename: 'database.sqlite' }
    case 'postgres':
      return {
        host: '127.0.0.1',
        port: 5432,
        user: 'postgres',
        password: '',
        database: name,
      }
    case 'mysql':
      return {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: name,
      }
    case 'mongodb':
      return { url: 'mongodb://localhost:27017', database: name }
    default:
      return {}
  }
}

function databaseFromEnv(driver) {
  switch (driver) {
    case 'sqlite':
      return defined({ filename: env('DATABASE_FILENAME') })
    case 'postgres':
    case 'mysql':
      return defined({
        host: env('DATABASE_HOST'),
        port: toNumber(env('DATABASE_PORT')),
        user: env('DATABASE_USER'),
        password: env('DATABASE_PASSWORD'),
        database: env('DATABASE_NAME'),
      })
    case 'mongodb':
      return defined({
        url: env('DATABASE_URL'),
        database: env('DATABASE_NAME'),
      })
    default:
      return {}
  }
}

function resolveDatabase(userDatabase, cwd) {
  const envDriver = env('DATABASE_DRIVER')
  // DATABASE_DRIVER=none keeps the default connection, exactly as
  // projects generated with "none" behaved before.
  const useEnv = envDriver !== undefined && envDriver !== 'none'
  const driver =
    (useEnv ? envDriver : userDatabase?.driver) ?? DEFAULT_CONFIG.database.driver

  return {
    ...driverDefaults(driver, cwd),
    ...defined(userDatabase),
    ...(useEnv ? databaseFromEnv(driver) : {}),
    driver,
  }
}

function mailFromEnv() {
  return defined({
    driver: env('MAIL_DRIVER'),
    from: env('MAIL_FROM'),
    host: env('MAIL_HOST'),
    port: toNumber(env('MAIL_PORT')),
    user: env('MAIL_USER'),
    password: env('MAIL_PASSWORD'),
    secure: toBoolean(env('MAIL_SECURE')),
  })
}

// Order, lowest to highest: built-in defaults, driver defaults, the project's
// tylix.config file, then .env. The config file holds project options; the
// connection details and secrets come from .env.
export async function loadConfig(cwd = process.cwd(), language = 'javascript') {
  await loadEnv(cwd)

  const extension = language === 'typescript' ? 'ts' : 'js'
  const configPath = path.join(cwd, `tylix.config.${extension}`)

  const exists = await fs
    .access(configPath)
    .then(() => true)
    .catch(() => false)

  let userConfig = {}

  if (exists) {
    const module = await import(pathToFileURL(configPath).href)
    userConfig = module.default ?? {}
  } else {
    // The config file is optional (.env and the defaults are enough), but a
    // JS/TS mismatch is almost always a mistake, so say so.
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
          `It is being ignored, so only .env and the defaults apply. ` +
          `Rename the file to match.`,
      )
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    database: resolveDatabase(userConfig.database, cwd),
    auth: {
      ...DEFAULT_CONFIG.auth,
      ...defined(userConfig.auth),
      ...defined({ secret: env('AUTH_SECRET') }),
    },
    mail: {
      ...DEFAULT_CONFIG.mail,
      ...defined(userConfig.mail),
      ...mailFromEnv(),
    },
  }
}