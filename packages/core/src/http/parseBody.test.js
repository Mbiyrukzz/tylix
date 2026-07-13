import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parseBody } from "./parseBody.js";

function createMockRequest(bodyString, contentType = "application/json") {
  const req = Readable.from([bodyString]);
  req.headers = { "content-type": contentType };
  return req;
}

test("parses a valid JSON body", async () => {
  const req = createMockRequest(JSON.stringify({ title: "Hello" }));
  const body = await parseBody(req);
  assert.deepEqual(body, { title: "Hello" });
});

test("returns empty object for empty body", async () => {
  const req = createMockRequest("");
  const body = await parseBody(req);
  assert.deepEqual(body, {});
});

test("returns empty object when content-type is not JSON", async () => {
  const req = createMockRequest("plain text", "text/plain");
  const body = await parseBody(req);
  assert.deepEqual(body, {});
});

test("rejects on malformed JSON", async () => {
  const req = createMockRequest("{not valid json");
  await assert.rejects(() => parseBody(req), /Invalid JSON body/);
});
