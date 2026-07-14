import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./loadConfig.js";

test("returns default sqlite config when no tylix.config.js exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-config-test-"));
  const config = await loadConfig(tmpDir);

  assert.equal(config.database.driver, "sqlite");
  assert.equal(config.database.filename, "database.sqlite");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("merges user tylix.config.js over defaults", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-config-test-"));

  await fs.writeFile(
    path.join(tmpDir, "tylix.config.js"),
    `export default {
      database: {
        driver: "sqlite",
        filename: "custom.sqlite",
      },
    };`
  );

  const config = await loadConfig(tmpDir);
  assert.equal(config.database.filename, "custom.sqlite");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("includes default auth config when no tylix.config.js exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-config-test-"));
  const config = await loadConfig(tmpDir);

  assert.equal(config.auth.secret, "tylix-dev-secret-change-me");
  assert.equal(config.auth.tokenExpiresInSeconds, 60 * 60 * 24 * 7);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("merges user-provided auth config over defaults", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tylix-config-test-"));

  await fs.writeFile(
    path.join(tmpDir, "tylix.config.js"),
    `export default {
      auth: {
        secret: "my-custom-secret",
      },
    };`
  );

  const config = await loadConfig(tmpDir);
  assert.equal(config.auth.secret, "my-custom-secret");
  assert.equal(config.auth.tokenExpiresInSeconds, 60 * 60 * 24 * 7);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
