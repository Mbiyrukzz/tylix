export const TokenType = {
  // Keywords
  PAGE: "PAGE",
  LAYOUT: "LAYOUT",
  STATE: "STATE",
  COMPUTED: "COMPUTED",
  WATCH: "WATCH",
  ACTION: "ACTION",
  TEMPLATE: "TEMPLATE",
  PROPS: "PROPS",
  ONMOUNT: "ONMOUNT",

  // Literals
  IDENTIFIER: "IDENTIFIER",
  NUMBER: "NUMBER",
  STRING: "STRING",

  // Punctuation
  LBRACE: "LBRACE", // {
  RBRACE: "RBRACE", // }
  LPAREN: "LPAREN", // (
  RPAREN: "RPAREN", // )
  COLON: "COLON", // :
  COMMA: "COMMA", // ,
  EQUALS: "EQUALS", // =
  SEMICOLON: "SEMICOLON", // ;
  DOT: "DOT", // .
  LBRACKET: "LBRACKET", // [
  RBRACKET: "RBRACKET", // ]
  ARROW: "ARROW", // =>
  RETURN: "RETURN",
  ASYNC: "ASYNC",
  AWAIT: "AWAIT",
  CONST: "CONST",
  LET: "LET",
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  GT: "GT",
  LT: "LT",

  // Template-specific
  TEMPLATE_TEXT: "TEMPLATE_TEXT", // raw HTML-like text between tags
  INTERP_START: "INTERP_START", // {{
  INTERP_END: "INTERP_END", // }}

  EOF: "EOF",
};

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
  let: TokenType.LET,
};
