import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer/Lexer.js";
import { Parser } from "./Parser.js";

test("parses an if statement with no else", () => {
  const source = `action\ncheck() {\n  if (this.ok) {\n    this.result = 1\n  }\n}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const stmt = page.actions[0].body[0];
  assert.equal(stmt.type, "IfStatement");
  assert.equal(stmt.alternate, null);
});

test("parses an if/else statement", () => {
  const source = `action\ncheck() {\n  if (this.ok) {\n    this.result = 1\n  } else {\n    this.result = 0\n  }\n}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const stmt = page.actions[0].body[0];
  assert.ok(stmt.alternate);
  assert.equal(stmt.alternate.length, 1);
});
