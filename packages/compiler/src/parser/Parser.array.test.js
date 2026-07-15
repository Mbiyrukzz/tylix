import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer/Lexer.js";
import { Parser } from "./Parser.js";

function parse(source) {
  return new Parser(new Lexer(source).tokenize()).parse();
}

test("parses an empty array literal as a state initial value", () => {
  const page = parse(`state\nproducts: []`);
  assert.equal(page.state[0].value.type, "ArrayExpression");
  assert.deepEqual(page.state[0].value.elements, []);
});

test("parses an array literal with elements", () => {
  const page = parse(`state\nids: [1, 2, 3]`);
  const elements = page.state[0].value.elements;
  assert.equal(elements.length, 3);
  assert.deepEqual(elements.map((e) => e.value), [1, 2, 3]);
});

test("parses an array literal assigned inside an action body", () => {
  const page = parse(`action\nclear() {\n  this.items = []\n}`);
  const assign = page.actions[0].body[0].expression;
  assert.equal(assign.type, "AssignmentExpression");
  assert.equal(assign.value.type, "ArrayExpression");
});

test("parses a bare state block with inconsistent trailing commas between entries", () => {
  const source = `state
  products: []
  title: "",
  price: ""`;
  const page = parse(source);
  assert.deepEqual(page.state.map((s) => s.name), ["products", "title", "price"]);
});
