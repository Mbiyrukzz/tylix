import { SqliteAdapter } from "./SqliteAdapter.js";
import { PostgresAdapter } from "./PostgresAdapter.js";
import { MysqlAdapter } from "./MysqlAdapter.js";

const ADAPTERS = {
  sqlite: SqliteAdapter,
  postgres: PostgresAdapter,
  mysql: MysqlAdapter,
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
