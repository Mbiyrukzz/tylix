import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFieldRuleNames } from "./resolveFieldRules.js";

test("string field defaults to required + isString", () => {
  const rules = resolveFieldRuleNames({ name: "title", type: "string" });
  assert.deepEqual(rules, ["required", "isString"]);
});

test("email field gets isString and isEmail", () => {
  const rules = resolveFieldRuleNames({ name: "email", type: "email" });
  assert.deepEqual(rules, ["required", "isString", "isEmail"]);
});

test("boolean field gets isBoolean", () => {
  const rules = resolveFieldRuleNames({ name: "published", type: "boolean" });
  assert.deepEqual(rules, ["required", "isBoolean"]);
});

test("field marked required: false omits the required rule", () => {
  const rules = resolveFieldRuleNames({ name: "nickname", type: "string", required: false });
  assert.deepEqual(rules, ["isString"]);
});
