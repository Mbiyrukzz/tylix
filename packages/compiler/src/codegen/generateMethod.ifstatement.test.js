import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMethod } from "./generateMethod.js";
import { Parser } from "../parser/Parser.js";
import { Lexer } from "../lexer/Lexer.js";

test("generates a real if/else branch that executes correctly", () => {
  const source = `action\ncheck(ok) {\n  if (ok) {\n    this.result = "yes"\n  } else {\n    this.result = "no"\n  }\n}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const methodSource = generateMethod(page.actions[0]);

  const classSource = `class Test { constructor() { this.result = null; } ${methodSource} }`;
  const TestClass = new Function(`return ${classSource}`)();
  const instance = new TestClass();

  instance.check(true);
  assert.equal(instance.result, "yes");
  instance.check(false);
  assert.equal(instance.result, "no");
});
