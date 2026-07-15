import { test } from "node:test";
import assert from "node:assert/strict";
import { generateExpression } from "./generateExpression.js";
import { CallExpr, MemberExpr, Identifier, Literal } from "../ast/nodes.js";

test("generates a call with no arguments", () => {
  const node = CallExpr(MemberExpr(Identifier("this"), "load"), []);
  assert.equal(generateExpression(node), "this.load()");
});

test("generates a call with multiple arguments", () => {
  const node = CallExpr(Identifier("remove"), [Literal(1), Literal("x")]);
  assert.equal(generateExpression(node), 'remove(1, "x")');
});

test("generates a call with a member-expression argument", () => {
  const node = CallExpr(Identifier("remove"), [MemberExpr(Identifier("post"), "id")]);
  assert.equal(generateExpression(node), "remove(post.id)");
});
