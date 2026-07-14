import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";

const DEFAULT_CONFIG = {
  database: {
    driver: "sqlite",
    filename: "database.sqlite",
  },
  auth: {
    secret: "tylix-dev-secret-change-me",
    tokenExpiresInSeconds: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function loadConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, "tylix.config.js");

  const exists = await fs.access(configPath).then(() => true).catch(() => false);
  if (!exists) {
    return DEFAULT_CONFIG;
  }

  const module = await import(pathToFileURL(configPath).href);
  const userConfig = module.default ?? {};

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
  };
}
