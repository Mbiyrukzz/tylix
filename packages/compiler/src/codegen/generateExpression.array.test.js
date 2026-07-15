import { test } from "node:test";
import assert from "node:assert/strict";
import { generateExpression } from "./generateExpression.js";
import { ArrayExpr, Literal } from "../ast/nodes.js";

test("generates an empty array literal", () => {
  assert.equal(generateExpression(ArrayExpr([])), "[]");
});

test("generates an array literal with literal elements", () => {
  const node = ArrayExpr([Literal(1), Literal(2), Literal("x")]);
  assert.equal(generateExpression(node), '[1, 2, "x"]');
});
