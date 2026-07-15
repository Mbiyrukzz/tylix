import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer/Lexer.js";
import { Parser } from "./Parser.js";

test("parses an async method with await and const declarations", () => {
  const source = `
action
async load() {
  const response = await fetch("/api/products")
  const data = await response.json()
  this.products = data
}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const method = page.actions[0];
  assert.equal(method.isAsync, true);
  assert.equal(method.body[0].type, "VariableDeclaration");
  assert.equal(method.body[0].kind, "const");
  assert.equal(method.body[0].init.type, "AwaitExpression");
});

test("parses an object literal expression", () => {
  const source = `
action
async save() {
  await fetch("/api/products", { method: "POST", body: this.name })
}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const call = page.actions[0].body[0].expression.argument;
  assert.equal(call.type, "CallExpression");
  assert.equal(call.args[1].type, "ObjectExpression");
  assert.equal(call.args[1].properties[0].key, "method");
});
