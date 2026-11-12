import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "./hashPassword.js";

test("hashPassword stores the scrypt parameters with the salt and key", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.notEqual(hash, "correct-horse-battery-staple");
  // scrypt$N$r$p$salt$key: the cost travels with each hash, so it can be
  // raised later without breaking passwords stored earlier.
  assert.match(hash, /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test("legacy salt:key hashes from before the parameters were stored still verify", async () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const key = scryptSync("old-password", salt, 64).toString("hex");
  const legacy = `${salt}:${key}`;
  assert.equal(await verifyPassword("old-password", legacy), true);
  assert.equal(await verifyPassword("wrong-password", legacy), false);
});

test("a stored hash with tampered, huge parameters is rejected, not computed", async () => {
  const hash = await hashPassword("pw-123456");
  const tampered = hash.replace(/^scrypt\$32768\$/, `scrypt$${2 ** 30}$`);
  assert.equal(await verifyPassword("pw-123456", tampered), false);
});

test("verifyPassword returns true for the correct password", async () => {
  const hash = await hashPassword("my-secret-password");
  const result = await verifyPassword("my-secret-password", hash);
  assert.equal(result, true);
});

test("verifyPassword returns false for an incorrect password", async () => {
  const hash = await hashPassword("my-secret-password");
  const result = await verifyPassword("wrong-password", hash);
  assert.equal(result, false);
});

test("two hashes of the same password are different (unique salts)", async () => {
  const hash1 = await hashPassword("same-password");
  const hash2 = await hashPassword("same-password");
  assert.notEqual(hash1, hash2);
});

test("verifyPassword returns false for a malformed stored hash", async () => {
  const result = await verifyPassword("anything", "not-a-valid-hash");
  assert.equal(result, false);
});
