import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./SqliteAdapter.js";

test("connects, creates a table, inserts, and queries rows", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-orm-test-"));
  const dbFile = path.join(tmpDir, "test.sqlite");

  const adapter = new SqliteAdapter({ filename: dbFile });
  await adapter.connect();

  await adapter.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    )
  `);

  await adapter.run("INSERT INTO posts (title) VALUES (?)", ["Hello Tylix"]);
  await adapter.run("INSERT INTO posts (title) VALUES (?)", ["Second Post"]);

  const all = await adapter.all("SELECT * FROM posts");
  assert.equal(all.length, 2);
  assert.equal(all[0].title, "Hello Tylix");

  const one = await adapter.get("SELECT * FROM posts WHERE id = ?", [1]);
  assert.equal(one.title, "Hello Tylix");

  await adapter.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("ensureConnected throws if used before connect()", async () => {
  const adapter = new SqliteAdapter({ filename: ":memory:" });
  await assert.rejects(() => adapter.all("SELECT 1"));
});
