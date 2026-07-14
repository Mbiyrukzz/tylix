import { test } from "node:test";
import assert from "node:assert/strict";
import { MysqlAdapter } from "./MysqlAdapter.js";

test("columnType maps logical types to MySQL SQL types", () => {
  const adapter = new MysqlAdapter({ database: "test" });
  assert.equal(adapter.columnType("increments"), "INT AUTO_INCREMENT PRIMARY KEY");
  assert.equal(adapter.columnType("string"), "VARCHAR(255)");
  assert.equal(adapter.columnType("boolean"), "TINYINT(1)");
  assert.equal(adapter.columnType("json"), "JSON");
});

test("columnType throws on unknown logical type", () => {
  const adapter = new MysqlAdapter({ database: "test" });
  assert.throws(() => adapter.columnType("nonsense"), /no mapping/);
});

test("ensureConnected throws before connect() is called", async () => {
  const adapter = new MysqlAdapter({ database: "test" });
  await assert.rejects(() => adapter.all("SELECT 1"));
});

test("toMysqlDateTime converts ISO 8601 strings to MySQL DATETIME format", async () => {
  const { toMysqlDateTime } = await import("./MysqlAdapter.js");
  assert.equal(
    toMysqlDateTime("2026-07-14T03:35:14.083Z"),
    "2026-07-14 03:35:14"
  );
});

test("toMysqlDateTime leaves non-ISO-datetime values untouched", async () => {
  const { toMysqlDateTime } = await import("./MysqlAdapter.js");
  assert.equal(toMysqlDateTime("Hello Tylix"), "Hello Tylix");
  assert.equal(toMysqlDateTime(42), 42);
  assert.equal(toMysqlDateTime(true), true);
});
