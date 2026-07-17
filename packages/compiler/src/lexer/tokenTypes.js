export const TokenType = {
  // Keywords
  PAGE: 'PAGE',
  LAYOUT: 'LAYOUT',
  STATE: 'STATE',
  COMPUTED: 'COMPUTED',
  WATCH: 'WATCH',
  ACTION: 'ACTION',
  TEMPLATE: 'TEMPLATE',
  PROPS: 'PROPS',
  ONMOUNT: 'ONMOUNT',

  // Literals
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  STRING: 'STRING',

  // Punctuation
  LBRACE: 'LBRACE', // {
  RBRACE: 'RBRACE', // }
  LPAREN: 'LPAREN', // (
  RPAREN: 'RPAREN', // )
  COLON: 'COLON', // :
  COMMA: 'COMMA', // ,
  EQUALS: 'EQUALS', // =
  SEMICOLON: 'SEMICOLON', // ;
  DOT: 'DOT', // .
  LBRACKET: 'LBRACKET', // [
  RBRACKET: 'RBRACKET', // ]
  ARROW: 'ARROW', // =>
  QUESTION: 'QUESTION', // ?
  RETURN: 'RETURN',
  ASYNC: 'ASYNC',
  AWAIT: 'AWAIT',
  CONST: 'CONST',
  IF: 'IF',
  ELSE: 'ELSE',
  LET: 'LET',
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  SLASH: 'SLASH',
  PERCENT: 'PERCENT', // %
  GT: 'GT',
  LT: 'LT',
  GTE: 'GTE', // >=
  LTE: 'LTE', // <=

  // Word operators (Tylix-native, not symbol-based)
  AND: 'AND', // and
  OR: 'OR', // or
  NOT: 'NOT', // not
  IS: 'IS', // is / is not
  HAS: 'HAS', // has (membership)
  EXISTS: 'EXISTS', // exists (postfix, != null)
  MISSING: 'MISSING', // missing (postfix, == null)

  // Loops
  FOR: 'FOR',
  IN: 'IN',
  FROM: 'FROM',
  TO: 'TO',
  REPEAT: 'REPEAT',
  BREAK: 'BREAK',
  CONTINUE: 'CONTINUE',

  PLUS_EQUALS: 'PLUS_EQUALS', // +=
  MINUS_EQUALS: 'MINUS_EQUALS', // -=
  STAR_EQUALS: 'STAR_EQUALS', // *=
  SLASH_EQUALS: 'SLASH_EQUALS', // /=
  TEMPLATE_LITERAL: 'TEMPLATE_LITERAL', // `text ${expr} text`

  // Template-specific
  TEMPLATE_TEXT: 'TEMPLATE_TEXT', // raw HTML-like text between tags
  INTERP_START: 'INTERP_START', // {{
  INTERP_END: 'INTERP_END', // }}

  EOF: 'EOF',
}

export const KEYWORDS = {
  page: TokenType.PAGE,
  layout: TokenType.LAYOUT,
  state: TokenType.STATE,
  computed: TokenType.COMPUTED,
  watch: TokenType.WATCH,
  action: TokenType.ACTION,
  template: TokenType.TEMPLATE,
  props: TokenType.PROPS,
  onMount: TokenType.ONMOUNT,
  return: TokenType.RETURN,
  async: TokenType.ASYNC,
  await: TokenType.AWAIT,
  const: TokenType.CONST,
  if: TokenType.IF,
  else: TokenType.ELSE,
  let: TokenType.LET,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  is: TokenType.IS,
  has: TokenType.HAS,
  exists: TokenType.EXISTS,
  missing: TokenType.MISSING,
  for: TokenType.FOR,
  in: TokenType.IN,
  from: TokenType.FROM,
  to: TokenType.TO,
  repeat: TokenType.REPEAT,
  break: TokenType.BREAK,
  continue: TokenType.CONTINUE,
}
