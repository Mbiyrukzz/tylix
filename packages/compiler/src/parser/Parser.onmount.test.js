import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer/Lexer.js";
import { Parser } from "./Parser.js";

test("parses a bare onMount body", () => {
  const source = `state\ncount: 0\nonMount\nthis.count = 5`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  assert.ok(page.onMount);
  assert.equal(page.onMount.body.length, 1);
});

test("parses an async onMount body with await", () => {
  const source = `state\nposts: 0\nonMount\nasync {\n  const data = await this.load()\n  this.posts = data\n}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  assert.equal(page.onMount.isAsync, true);
  assert.equal(page.onMount.body.length, 2);
});
