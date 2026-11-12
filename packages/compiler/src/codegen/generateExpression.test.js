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

// Assignments are always parenthesized, like binary expressions: the
// generator doesn't know where a subexpression lands, and an unwrapped
// assignment is invalid as an operand ("a && b = 1") and is misread as a
// block when it destructures ("{ a } = obj").
test("generates an assignment expression", () => {
  const node = AssignmentExpr(MemberExpr(Identifier("this"), "count"), Literal(0));
  assert.equal(generateExpression(node), "(this.count = 0)");
});

test("generates an assignment with a binary expression value", () => {
  const node = AssignmentExpr(
    MemberExpr(Identifier("this"), "count"),
    BinaryExpr("+", MemberExpr(Identifier("this"), "count"), Literal(1))
  );
  assert.equal(generateExpression(node), "(this.count = (this.count + 1))");
});

test("an assignment used as an operand still compiles to valid JavaScript", () => {
  const node = BinaryExpr("&&", Identifier("ready"), AssignmentExpr(Identifier("count"), Literal(1)));
  const source = generateExpression(node);
  assert.equal(source, "(ready && (count = 1))");
  let count = 0;
  const ready = true;
  // eslint-disable-next-line no-new-func
  new Function("ready", "set", `let count = 0; ${source}; set(count)`)(ready, (v) => (count = v));
  assert.equal(count, 1);
});

test("throws on an unknown node type", () => {
  assert.throws(() => generateExpression({ type: "Bogus" }), /unknown node type "Bogus"/);
});
