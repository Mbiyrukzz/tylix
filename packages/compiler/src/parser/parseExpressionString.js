import { Lexer } from "../lexer/Lexer.js";
import { Parser } from "./Parser.js";

/**
 * Parses a single expression (no statements) from a raw string, e.g.
 * the inside of a template interpolation: "count * 2" or "increment".
 * Reuses Parser's expression grammar directly rather than duplicating it.
 */
export function parseExpressionString(source) {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  return parser.parseExpression();
}
