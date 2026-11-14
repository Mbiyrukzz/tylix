import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, createAuth, setSessionGuard } from "@tylix/auth";
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
  const token = signToken({ userId: 7 }, "test-secret", { expiresInSeconds: 60 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createMockRes();

  let calledWith = null;
  const handler = requireAuth((req, res) => {
    calledWith = req.user;
    res.json({ ok: true });
  }, "test-secret");

  await handler(req, res);

  assert.equal(calledWith.userId, 7);
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

const SECRET = "test-secret-that-is-long-enough-0123456789";

async function run(token, secret = SECRET) {
  const res = createMockRes();
  let user = null;
  await requireAuth((req) => { user = req.user; }, secret)({ headers: { authorization: `Bearer ${token}` } }, res);
  return { status: res.statusCode, user };
}

test("refuses an email-verification token used as a login (regression)", async () => {
  const link = signToken({ userId: 7, purpose: "email-verify" }, SECRET, { expiresInSeconds: 86400 });
  assert.equal((await run(link)).status, 401);
});

test("refuses legacy tokens that never expire", async () => {
  assert.equal((await run(signToken({ userId: 7 }, SECRET))).status, 401);
});

test("accepts session JWTs and refuses them once the session is ended", async () => {
  const auth = createAuth({ secret: SECRET, claims: (s) => ({ userId: s.userId }) });
  const { accessToken, session } = await auth.signIn(null, 7);
  setSessionGuard((claims) => auth.isSessionActive(claims.sid, claims.uid));
  try {
    const ok = await run(accessToken);
    assert.equal(ok.status, 200);
    assert.equal(ok.user.userId, 7);
    await auth.revokeSession(session.id);
    assert.equal((await run(accessToken)).status, 401);
  } finally {
    setSessionGuard(null);
  }
});

test("refuses JWTs of another type even with the right secret", async () => {
  const auth = createAuth({ secret: SECRET });
  const link = await auth.tokens.sign({ uid: 7 }, { type: "email-verify", expiresIn: "1d" });
  assert.equal((await run(link)).status, 401);
});
