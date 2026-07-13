import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate.js";
import { required, isString, isBoolean, isEmail } from "./rules.js";

test("passes when all rules succeed", () => {
  const result = validate(
    { title: "Hello", published: true },
    { title: [required, isString], published: [isBoolean] }
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
});

test("collects errors for missing required fields", () => {
  const result = validate({}, { title: [required] });
  assert.equal(result.valid, false);
  assert.equal(result.errors.title[0], "This field is required.");
});

test("collects multiple errors per field", () => {
  const result = validate({ title: 123 }, { title: [required, isString] });
  assert.equal(result.valid, false);
  assert.equal(result.errors.title.length, 1);
  assert.match(result.errors.title[0], /must be a string/);
});

test("isEmail rejects invalid email format", () => {
  const result = validate({ email: "not-an-email" }, { email: [isEmail] });
  assert.equal(result.valid, false);
});

test("isEmail accepts a valid email", () => {
  const result = validate({ email: "test@example.com" }, { email: [isEmail] });
  assert.equal(result.valid, true);
});

test("optional fields (not required) skip validation when undefined", () => {
  const result = validate({}, { nickname: [isString] });
  assert.equal(result.valid, true);
});
