import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./hashPassword.js";

test("hashPassword produces a salt:hash string different from the plain password", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.notEqual(hash, "correct-horse-battery-staple");
  assert.match(hash, /^[0-9a-f]+:[0-9a-f]+$/);
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
