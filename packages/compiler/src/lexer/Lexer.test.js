import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "./Lexer.js";
import { TokenType } from "./tokenTypes.js";

function tokenTypes(source) {
  return new Lexer(source).tokenize().map((t) => t.type);
}

test("tokenizes keywords", () => {
  const types = tokenTypes("page state action computed watch template props");
  assert.deepEqual(types, [
    TokenType.PAGE,
    TokenType.STATE,
    TokenType.ACTION,
    TokenType.COMPUTED,
    TokenType.WATCH,
    TokenType.TEMPLATE,
    TokenType.PROPS,
    TokenType.EOF,
  ]);
});

test("tokenizes an identifier that is not a keyword", () => {
  const tokens = new Lexer("count").tokenize();
  assert.equal(tokens[0].type, TokenType.IDENTIFIER);
  assert.equal(tokens[0].value, "count");
});

test("tokenizes a number literal", () => {
  const tokens = new Lexer("42").tokenize();
  assert.equal(tokens[0].type, TokenType.NUMBER);
  assert.equal(tokens[0].value, 42);
});

test("tokenizes a decimal number literal", () => {
  const tokens = new Lexer("3.14").tokenize();
  assert.equal(tokens[0].value, 3.14);
});

test("tokenizes single and double quoted strings", () => {
  const tokens = new Lexer(`"hello" 'world'`).tokenize();
  assert.equal(tokens[0].type, TokenType.STRING);
  assert.equal(tokens[0].value, "hello");
  assert.equal(tokens[1].type, TokenType.STRING);
  assert.equal(tokens[1].value, "world");
});

test("tokenizes braces, parens, and punctuation", () => {
  const types = tokenTypes("{ } ( ) : , ; . =");
  assert.deepEqual(types, [
    TokenType.LBRACE,
    TokenType.RBRACE,
    TokenType.LPAREN,
    TokenType.RPAREN,
    TokenType.COLON,
    TokenType.COMMA,
    TokenType.SEMICOLON,
    TokenType.DOT,
    TokenType.EQUALS,
    TokenType.EOF,
  ]);
});

test("tokenizes the arrow operator distinctly from equals", () => {
  const types = tokenTypes("=>");
  assert.deepEqual(types, [TokenType.ARROW, TokenType.EOF]);
});

test("tokenizes interpolation markers distinctly from braces", () => {
  const types = tokenTypes("{{ count }}");
  assert.deepEqual(types, [
    TokenType.INTERP_START,
    TokenType.IDENTIFIER,
    TokenType.INTERP_END,
    TokenType.EOF,
  ]);
});

test("skips single-line comments", () => {
  const types = tokenTypes("count // this is a comment\naction");
  assert.deepEqual(types, [TokenType.IDENTIFIER, TokenType.ACTION, TokenType.EOF]);
});

test("skips multi-line comments", () => {
  const types = tokenTypes("count /* skip\nthis */ action");
  assert.deepEqual(types, [TokenType.IDENTIFIER, TokenType.ACTION, TokenType.EOF]);
});

test("tokenizes a realistic state block", () => {
  const source = `state { count: 0 }`;
  const types = tokenTypes(source);
  assert.deepEqual(types, [
    TokenType.STATE,
    TokenType.LBRACE,
    TokenType.IDENTIFIER,
    TokenType.COLON,
    TokenType.NUMBER,
    TokenType.RBRACE,
    TokenType.EOF,
  ]);
});

test("tokenizes a realistic action block with a method call body", () => {
  const source = `action { increment() { count = count + 1; } }`;
  const types = tokenTypes(source);
  assert.deepEqual(types, [
    TokenType.ACTION,
    TokenType.LBRACE,
    TokenType.IDENTIFIER,
    TokenType.LPAREN,
    TokenType.RPAREN,
    TokenType.LBRACE,
    TokenType.IDENTIFIER,
    TokenType.EQUALS,
    TokenType.IDENTIFIER,
    TokenType.PLUS,
    TokenType.NUMBER,
    TokenType.SEMICOLON,
    TokenType.RBRACE,
    TokenType.RBRACE,
    TokenType.EOF,
  ]);
});

test("tokenizes arithmetic and comparison operators", () => {
  const types = tokenTypes("+ - * / > <");
  assert.deepEqual(types, [
    TokenType.PLUS,
    TokenType.MINUS,
    TokenType.STAR,
    TokenType.SLASH,
    TokenType.GT,
    TokenType.LT,
    TokenType.EOF,
  ]);
});

test("throws a clear error on an unexpected character", () => {
  assert.throws(() => new Lexer("state # invalid").tokenize(), /Unexpected character "#"/);
});

test("throws a clear error on an unterminated string", () => {
  assert.throws(() => new Lexer(`"never closed`).tokenize(), /Unterminated string/);
});

test("tracks line numbers across newlines", () => {
  const tokens = new Lexer("count\naction").tokenize();
  assert.equal(tokens[0].line, 1);
  assert.equal(tokens[1].line, 2);
});
