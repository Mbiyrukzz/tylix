import { test } from "node:test";
import assert from "node:assert/strict";
import { enhanceResponse } from "./enhanceResponse.js";

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(data) {
      this.body = data;
    },
  };
}

test("status() sets statusCode and returns res for chaining", () => {
  const res = enhanceResponse(createMockResponse());
  const result = res.status(404);
  assert.equal(res.statusCode, 404);
  assert.equal(result, res);
});

test("json() sets content-type and serializes body", () => {
  const res = enhanceResponse(createMockResponse());
  res.json({ hello: "world" });
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.body, JSON.stringify({ hello: "world" }));
});

test("status().json() chains correctly", () => {
  const res = enhanceResponse(createMockResponse());
  res.status(201).json({ id: 1 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body, JSON.stringify({ id: 1 }));
});

test("send() with no args ends the response with no body", () => {
  const res = enhanceResponse(createMockResponse());
  res.status(204).send();
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, undefined);
});
