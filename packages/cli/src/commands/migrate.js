import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrapDatabase } from "../bootstrap.js";

function buildSchema(adapter) {
  return {
    createTable: async (tableName, callback) => {
      const columns = [];

      function column(name, logicalType) {
        const def = { name, logicalType, unique: false };
        columns.push(def);
        return {
          unique: () => {
            def.unique = true;
          },
        };
      }

      const table = {
        increments: (name) => column(name, "increments"),
        string: (name) => column(name, "string"),
        text: (name) => column(name, "text"),
        boolean: (name) => column(name, "boolean"),
        integer: (name) => column(name, "integer"),
        date: (name) => column(name, "date"),
        datetime: (name) => column(name, "datetime"),
        json: (name) => column(name, "json"),
        timestamps: () => {
          columns.push({ name: "created_at", logicalType: "timestamp", unique: false });
          columns.push({ name: "updated_at", logicalType: "timestamp", unique: false });
        },
      };

      await callback(table);

      const columnSql = columns
        .map((c) => {
          const sqlType = adapter.columnType(c.logicalType);
          return `${c.name} ${sqlType}${c.unique ? " UNIQUE" : ""}`;
        })
        .join(", ");

      await adapter.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnSql})`);
    },

    dropTable: async (tableName) => {
      await adapter.run(`DROP TABLE IF EXISTS ${tableName}`);
    },
  };
}

export async function migrate() {
  const adapter = await bootstrapDatabase();

  await adapter.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id ${adapter.columnType("increments")},
      filename VARCHAR(255) NOT NULL UNIQUE,
      run_at TEXT NOT NULL
    )
  `);

  const migrationsDir = path.join(process.cwd(), "database", "migrations");
  const exists = await fs.access(migrationsDir).then(() => true).catch(() => false);

  if (!exists) {
    console.log("No migrations directory found.");
    await adapter.close();
    return;
  }

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".js"))
    .sort();

  const alreadyRun = await adapter.all("SELECT * FROM migrations");
  const alreadyRunSet = new Set(alreadyRun.map((r) => r.filename));

  const schema = buildSchema(adapter);
  let ranCount = 0;

  for (const file of files) {
    if (alreadyRunSet.has(file)) continue;

    const modulePath = pathToFileURL(path.join(migrationsDir, file)).href;
    const migration = await import(modulePath);

    await migration.up(schema);

    await adapter.run(
      "INSERT INTO migrations (filename, run_at) VALUES (?, ?)",
      [file, new Date().toISOString()]
    );

    console.log(`✔ Migrated: ${file}`);
    ranCount++;
  }

  if (ranCount === 0) {
    console.log("Nothing to migrate.");
  }

  await adapter.close();
}
