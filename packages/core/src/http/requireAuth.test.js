import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken } from "@tylix/auth";
import { requireAuth } from "./requireAuth.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

test("calls the handler and sets req.user when the token is valid", async () => {
  const token = signToken({ userId: 7 }, "test-secret");
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createMockRes();

  let calledWith = null;
  const handler = requireAuth((req, res) => {
    calledWith = req.user;
    res.json({ ok: true });
  }, "test-secret");

  await handler(req, res);

  assert.deepEqual(calledWith, { userId: 7 });
  assert.deepEqual(res.body, { ok: true });
});

test("responds 401 when Authorization header is missing", async () => {
  const req = { headers: {} };
  const res = createMockRes();

  const handler = requireAuth(() => {
    throw new Error("should not be called");
  }, "test-secret");

  await handler(req, res);

  assert.equal(res.statusCode, 401);
});

test("responds 401 when the token is signed with a different secret", async () => {
  const token = signToken({ userId: 1 }, "wrong-secret");
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createMockRes();

  const handler = requireAuth(() => {
    throw new Error("should not be called");
  }, "test-secret");

  await handler(req, res);

  assert.equal(res.statusCode, 401);
});

test("responds 401 when the Authorization header has no Bearer scheme", async () => {
  const req = { headers: { authorization: "Basic abc123" } };
  const res = createMockRes();

  const handler = requireAuth(() => {
    throw new Error("should not be called");
  }, "test-secret");

  await handler(req, res);

  assert.equal(res.statusCode, 401);
});
