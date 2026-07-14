import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "./signToken.js";

test("signToken produces a two-part dot-separated string", () => {
  const token = signToken({ userId: 1 }, "test-secret");
  assert.equal(token.split(".").length, 2);
});

test("verifyToken accepts a validly signed token and returns the payload", () => {
  const token = signToken({ userId: 42 }, "test-secret");
  const result = verifyToken(token, "test-secret");
  assert.equal(result.valid, true);
  assert.equal(result.payload.userId, 42);
});

test("verifyToken rejects a token signed with a different secret", () => {
  const token = signToken({ userId: 1 }, "secret-a");
  const result = verifyToken(token, "secret-b");
  assert.equal(result.valid, false);
  assert.equal(result.error, "Invalid signature");
});

test("verifyToken rejects a tampered payload", () => {
  const token = signToken({ userId: 1 }, "test-secret");
  const [, signature] = token.split(".");
  const tampered = `${Buffer.from(JSON.stringify({ userId: 999 })).toString("base64url")}.${signature}`;
  const result = verifyToken(tampered, "test-secret");
  assert.equal(result.valid, false);
});

test("verifyToken rejects an expired token", () => {
  const token = signToken({ userId: 1 }, "test-secret", { expiresInSeconds: -10 });
  const result = verifyToken(token, "test-secret");
  assert.equal(result.valid, false);
  assert.equal(result.error, "Token expired");
});

test("verifyToken accepts a token that has not yet expired", () => {
  const token = signToken({ userId: 1 }, "test-secret", { expiresInSeconds: 3600 });
  const result = verifyToken(token, "test-secret");
  assert.equal(result.valid, true);
});

test("verifyToken rejects a malformed token string", () => {
  const result = verifyToken("not-a-real-token", "test-secret");
  assert.equal(result.valid, false);
  assert.equal(result.error, "Malformed token");
});
