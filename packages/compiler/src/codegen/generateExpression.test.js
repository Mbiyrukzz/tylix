import { test } from "node:test";
import assert from "node:assert/strict";
import { generateExpression } from "./generateExpression.js";
import {
  Literal,
  Identifier,
  MemberExpr,
  BinaryExpr,
  AssignmentExpr,
} from "../ast/nodes.js";

test("generates a number literal", () => {
  assert.equal(generateExpression(Literal(42)), "42");
});

test("generates a string literal as a properly quoted JS string", () => {
  assert.equal(generateExpression(Literal("hello")), '"hello"');
});

test("generates an identifier", () => {
  assert.equal(generateExpression(Identifier("count")), "count");
});

test("generates a member expression", () => {
  const node = MemberExpr(Identifier("this"), "count");
  assert.equal(generateExpression(node), "this.count");
});

test("generates a chained member expression", () => {
  const node = MemberExpr(MemberExpr(Identifier("this"), "state"), "count");
  assert.equal(generateExpression(node), "this.state.count");
});

test("generates a binary expression wrapped in parens", () => {
  const node = BinaryExpr("+", Identifier("count"), Literal(1));
  assert.equal(generateExpression(node), "(count + 1)");
});

test("generates a nested binary expression", () => {
  const node = BinaryExpr("*", BinaryExpr("+", Identifier("a"), Identifier("b")), Literal(2));
  assert.equal(generateExpression(node), "((a + b) * 2)");
});

test("generates an assignment expression", () => {
  const node = AssignmentExpr(MemberExpr(Identifier("this"), "count"), Literal(0));
  assert.equal(generateExpression(node), "this.count = 0");
});

test("generates an assignment with a binary expression value", () => {
  const node = AssignmentExpr(
    MemberExpr(Identifier("this"), "count"),
    BinaryExpr("+", MemberExpr(Identifier("this"), "count"), Literal(1))
  );
  assert.equal(generateExpression(node), "this.count = (this.count + 1)");
});

test("throws on an unknown node type", () => {
  assert.throws(() => generateExpression({ type: "Bogus" }), /unknown node type "Bogus"/);
});
