import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer/Lexer.js";
import { Parser } from "./Parser.js";

function parse(source) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

test("parses a props block", () => {
  const ast = parse(`props { title: String }`);
  assert.deepEqual(ast.props, [{ type: "Prop", name: "title", propType: "String" }]);
});

test("parses a state block with number and string values", () => {
  const ast = parse(`state { count: 0, label: "hi" }`);
  assert.deepEqual(ast.state, [
    { type: "State", name: "count", value: { type: "Literal", value: 0 } },
    { type: "State", name: "label", value: { type: "Literal", value: "hi" } },
  ]);
});

test("parses a computed block with return + member/binary expressions", () => {
  const ast = parse(`
    computed {
      doubled() {
        return this.count * 2
      }
    }
  `);
  const method = ast.computed[0];
  assert.equal(method.name, "doubled");
  assert.deepEqual(method.params, []);
  assert.equal(method.body[0].type, "ReturnStatement");
  assert.deepEqual(method.body[0].argument, {
    type: "BinaryExpression",
    operator: "*",
    left: {
      type: "MemberExpression",
      object: { type: "Identifier", name: "this" },
      property: "count",
    },
    right: { type: "Literal", value: 2 },
  });
});

test("parses an action block with an assignment statement", () => {
  const ast = parse(`
    action {
      increment() {
        count = count + 1;
      }
    }
  `);
  const method = ast.actions[0];
  assert.equal(method.name, "increment");
  assert.deepEqual(method.body[0].expression, {
    type: "AssignmentExpression",
    target: { type: "Identifier", name: "count" },
    value: {
      type: "BinaryExpression",
      operator: "+",
      left: { type: "Identifier", name: "count" },
      right: { type: "Literal", value: 1 },
    },
  });
});

test("parses a method with parameters", () => {
  const ast = parse(`
    action {
      setCount(newValue) {
        count = newValue;
      }
    }
  `);
  assert.deepEqual(ast.actions[0].params, ["newValue"]);
});

test("parses a full realistic page script", () => {
  const ast = parse(`
    props { title: String }
    state { count: 0 }
    computed {
      doubled() { return count * 2 }
    }
    action {
      increment() { count = count + 1; }
    }
  `);
  assert.equal(ast.props.length, 1);
  assert.equal(ast.state.length, 1);
  assert.equal(ast.computed.length, 1);
  assert.equal(ast.actions.length, 1);
});

test("throws a clear error when a state entry is missing its colon", () => {
  assert.throws(() => parse(`state { count 0 }`), /Expected ':'/);
});

test("throws a clear error on an unknown top-level keyword", () => {
  assert.throws(() => parse(`bogus { }`), /Unexpected token/);
});
