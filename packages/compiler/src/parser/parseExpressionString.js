import { Lexer } from '../lexer/Lexer.js'
import { Parser } from './Parser.js'
import { TokenType } from '../lexer/tokenTypes.js'

/**
 * Parses a single expression (no statements) from a raw string, e.g.
 * the inside of a template interpolation: "count * 2" or "increment".
 * Reuses Parser's expression grammar directly rather than duplicating it.
 *
 * Anything left over after the expression is an error rather than
 * being silently dropped (`{{ a b }}`, `{{ a(); b() }}`).
 */
export function parseExpressionString(source, options = {}) {
  const tokens = new Lexer(source).tokenize()
  const parser = new Parser(tokens, options)
  const expression = parser.parseExpression()
  if (!parser.check(TokenType.EOF)) {
    const next = parser.peek()
    throw new Error(
      `Unexpected "${next.value ?? next.type}" in expression "${source.trim()}"`,
    )
  }
  return expression
}