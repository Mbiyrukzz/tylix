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
  USES: 'USES',
  CAPABILITY: 'CAPABILITY',
  INIT: 'INIT',
  ONMOUNT: 'ONMOUNT',
  NEEDS: 'NEEDS',
  PREFETCH: 'PREFETCH',
  BACKGROUND: 'BACKGROUND',
  PERMISSIONS: 'PERMISSIONS',
  META: 'META',
  TITLE: 'TITLE',
  DURATION: 'DURATION',
  NEW: 'NEW',
  TRY: 'TRY',
  CATCH: 'CATCH',
  FINALLY: 'FINALLY',
  TYPEOF: 'TYPEOF',
  INSTANCEOF: 'INSTANCEOF',
  THROW: 'THROW',
  WHILE: 'WHILE',
  DO: 'DO',
  SWITCH: 'SWITCH',
  CASE: 'CASE',
  DEFAULT: 'DEFAULT',
  DELETE: 'DELETE',
  VOID: 'VOID',
  OF: 'OF',
  FUNCTION: 'FUNCTION',

  // Literals
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  BIGINT: 'BIGINT', // 10n -> value is the digit text without the "n"
  STRING: 'STRING',
  REGEX: 'REGEX', // /pattern/flags -> value is { pattern, flags }

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
  SPREAD: 'SPREAD', // ...
  ARROW: 'ARROW', // =>
  QUESTION: 'QUESTION', // ?
  QUESTION_DOT: 'QUESTION_DOT', // ?.
  NULLISH: 'NULLISH', // ??
  NULLISH_EQUALS: 'NULLISH_EQUALS', // ??=
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
  STAR_STAR: 'STAR_STAR', // **
  PLUS_PLUS: 'PLUS_PLUS', // ++
  MINUS_MINUS: 'MINUS_MINUS', // --
  GT: 'GT',
  LT: 'LT',
  GTE: 'GTE', // >=
  LTE: 'LTE', // <=
  PIPE: 'PIPE', // |  (union type separator AND bitwise OR)
  AMP: 'AMP', // &  (bitwise AND)
  CARET: 'CARET', // ^  (bitwise XOR)
  TILDE: 'TILDE', // ~  (bitwise NOT)
  // Shifts (<< >> >>>) are NOT single tokens: the Lexer emits them as
  // adjacent LT/GT tokens so generic types like Array<Array<T>> still
  // close correctly. The Parser recombines adjacent tokens in
  // expression context (see Parser.shiftOperatorAt).

  // Word operators (Tylix-native, not symbol-based)
  AND: 'AND', // and, &&
  OR: 'OR', // or, ||
  NOT: 'NOT', // not, !
  IS: 'IS', // is / is not, ==, ===, !=, !==
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
  PERCENT_EQUALS: 'PERCENT_EQUALS', // %=
  STAR_STAR_EQUALS: 'STAR_STAR_EQUALS', // **=
  OR_EQUALS: 'OR_EQUALS', // ||=
  AND_EQUALS: 'AND_EQUALS', // &&=
  AMP_EQUALS: 'AMP_EQUALS', // &=
  PIPE_EQUALS: 'PIPE_EQUALS', // |=
  CARET_EQUALS: 'CARET_EQUALS', // ^=
  TEMPLATE_LITERAL: 'TEMPLATE_LITERAL', // `text ${expr} text`

  // Template-specific
  TEMPLATE_TEXT: 'TEMPLATE_TEXT', // raw HTML-like text between tags
  INTERP_START: 'INTERP_START', // {{ (no longer produced by the Lexer)
  INTERP_END: 'INTERP_END', // }} (no longer produced by the Lexer)

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
  uses: TokenType.USES,
  capability: TokenType.CAPABILITY,
  init: TokenType.INIT,
  title: TokenType.TITLE,
  needs: TokenType.NEEDS,
  prefetch: TokenType.PREFETCH,
  background: TokenType.BACKGROUND,
  permissions: TokenType.PERMISSIONS,
  meta: TokenType.META,
  actions: TokenType.ACTION,
  onMount: TokenType.ONMOUNT,
  new: TokenType.NEW,
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
  of: TokenType.OF,
  from: TokenType.FROM,
  to: TokenType.TO,
  repeat: TokenType.REPEAT,
  break: TokenType.BREAK,
  continue: TokenType.CONTINUE,
  try: TokenType.TRY,
  catch: TokenType.CATCH,
  finally: TokenType.FINALLY,
  typeof: TokenType.TYPEOF,
  instanceof: TokenType.INSTANCEOF,
  throw: TokenType.THROW,
  while: TokenType.WHILE,
  do: TokenType.DO,
  switch: TokenType.SWITCH,
  case: TokenType.CASE,
  default: TokenType.DEFAULT,
  delete: TokenType.DELETE,
  void: TokenType.VOID,
  function: TokenType.FUNCTION,
}