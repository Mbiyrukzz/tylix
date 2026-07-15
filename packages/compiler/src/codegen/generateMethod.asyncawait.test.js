import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMethod } from "./generateMethod.js";
import { Parser } from "../parser/Parser.js";
import { Lexer } from "../lexer/Lexer.js";

test("generates a real async method that awaits a resolved promise", async () => {
  const source = `
action
async load() {
  const value = await this.fetchValue()
  this.result = value
}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const methodSource = generateMethod(page.actions[0]);

  const classSource = `class Test {
  constructor() { this.result = null; }
  async fetchValue() { return 42; }
${methodSource}
}`;
  const TestClass = new Function(`return ${classSource}`)();
  const instance = new TestClass();
  await instance.load();
  assert.equal(instance.result, 42);
});

test("generates an object literal argument correctly", () => {
  const source = `
action
async save() {
  await this.post({ method: "POST", id: 5 })
}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const methodSource = generateMethod(page.actions[0]);
  assert.match(methodSource, /this\.post\(\{ "method": "POST", "id": 5 \}\)/);
});
