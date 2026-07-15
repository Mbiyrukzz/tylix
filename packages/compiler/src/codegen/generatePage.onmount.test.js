import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePage } from "./generatePage.js";
import { reactive } from "../runtime/reactive.js";
import { Parser } from "../parser/Parser.js";
import { Lexer } from "../lexer/Lexer.js";

test("onMount runs automatically on construction", () => {
  const source = `state\ncount: 0\nonMount\nthis.count = 99`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const classSource = generatePage(page, "Page");
  const Page = new Function("reactive", `return ${classSource}`)(reactive);

  const instance = new Page();
  assert.equal(instance.count, 99);
});

test("async onMount can await before setting state", async () => {
  const source = `state\ndata: 0\nonMount\nasync {\n  const value = await this.fetchIt()\n  this.data = value\n}`;
  const page = new Parser(new Lexer(source).tokenize()).parse();
  const classSource = generatePage(page, "Page");

  const PageClass = new Function(
    "reactive",
    `const Page = ${classSource};
     Page.prototype.fetchIt = async function () { return 123; };
     return Page;`
  )(reactive);

  const instance = new PageClass();
  await instance.__onMount();
  assert.equal(instance.data, 123);
});
