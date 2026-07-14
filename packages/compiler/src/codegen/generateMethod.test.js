import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMethod } from "./generateMethod.js";
import {
  MethodNode,
  ReturnStatement,
  ExpressionStatement,
  AssignmentExpr,
  BinaryExpr,
  MemberExpr,
  Identifier,
  Literal,
} from "../ast/nodes.js";

test("generates a zero-parameter method with a single return statement", () => {
  const node = MethodNode(
    "doubled",
    [],
    [ReturnStatement(BinaryExpr("*", MemberExpr(Identifier("this"), "count"), Literal(2)))]
  );

  const code = generateMethod(node);
  assert.equal(code, "  doubled() {\n    return (this.count * 2);\n  }");
});

test("generates a method with parameters", () => {
  const node = MethodNode("setCount", ["value"], [
    ExpressionStatement(AssignmentExpr(MemberExpr(Identifier("this"), "count"), Identifier("value"))),
  ]);

  const code = generateMethod(node);
  assert.equal(code, "  setCount(value) {\n    this.count = value;\n  }");
});

test("generates a method with multiple statements", () => {
  const node = MethodNode(
    "increment",
    [],
    [
      ExpressionStatement(
        AssignmentExpr(
          MemberExpr(Identifier("this"), "count"),
          BinaryExpr("+", MemberExpr(Identifier("this"), "count"), Literal(1))
        )
      ),
      ReturnStatement(MemberExpr(Identifier("this"), "count")),
    ]
  );

  const code = generateMethod(node);
  assert.equal(
    code,
    "  increment() {\n    this.count = (this.count + 1);\n    return this.count;\n  }"
  );
});

test("the generated method source is valid, executable JavaScript", () => {
  const node = MethodNode(
    "increment",
    [],
    [
      ExpressionStatement(
        AssignmentExpr(
          MemberExpr(Identifier("this"), "count"),
          BinaryExpr("+", MemberExpr(Identifier("this"), "count"), Literal(1))
        )
      ),
    ]
  );

  const methodSource = generateMethod(node);
  const classSource = `class Test { ${methodSource} }`;
  const TestClass = new Function(`return ${classSource}`)();

  const instance = new TestClass();
  instance.count = 5;
  instance.increment();
  assert.equal(instance.count, 6);
});
