import { test } from "node:test";
import assert from "node:assert/strict";
import { generateStatement } from "./generateStatement.js";
import {
  ReturnStatement,
  ExpressionStatement,
  AssignmentExpr,
  BinaryExpr,
  MemberExpr,
  Identifier,
  Literal,
} from "../ast/nodes.js";

test("generates a return statement", () => {
  const node = ReturnStatement(BinaryExpr("*", MemberExpr(Identifier("this"), "count"), Literal(2)));
  assert.equal(generateStatement(node), "return (this.count * 2);");
});

test("generates an expression statement wrapping an assignment", () => {
  const node = ExpressionStatement(
    AssignmentExpr(
      MemberExpr(Identifier("this"), "count"),
      BinaryExpr("+", MemberExpr(Identifier("this"), "count"), Literal(1))
    )
  );
  assert.equal(generateStatement(node), "this.count = (this.count + 1);");
});

test("throws on an unknown statement type", () => {
  assert.throws(() => generateStatement({ type: "Bogus" }), /unknown node type "Bogus"/);
});
