import { SqliteAdapter } from "./SqliteAdapter.js";

const ADAPTERS = {
  sqlite: SqliteAdapter,
};

export function createAdapter(databaseConfig) {
  const { driver, ...options } = databaseConfig;

  const AdapterClass = ADAPTERS[driver];
  if (!AdapterClass) {
    throw new Error(
      `Unknown database driver "${driver}". Available drivers: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }

  return new AdapterClass(options);
}
