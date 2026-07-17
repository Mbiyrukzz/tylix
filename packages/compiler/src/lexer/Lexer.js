import { TokenType, KEYWORDS } from './tokenTypes.js'

const SINGLE_CHAR_TOKENS = {
  '(': TokenType.LPAREN,
  ')': TokenType.RPAREN,
  ':': TokenType.COLON,
  ',': TokenType.COMMA,
  ';': TokenType.SEMICOLON,
  '.': TokenType.DOT,
  '[': TokenType.LBRACKET,
  ']': TokenType.RBRACKET,
}

export class Lexer {
  constructor(source) {
    this.source = source
    this.pos = 0
    this.line = 1
    this.tokens = []
  }

  tokenize() {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments()
      if (this.pos >= this.source.length) break

      const char = this.source[this.pos]

      if (char === '{' && this.source[this.pos + 1] === '{') {
        this.pushToken(TokenType.INTERP_START, '{{')
        this.pos += 2
        continue
      }

      if (char === '}' && this.source[this.pos + 1] === '}') {
        this.pushToken(TokenType.INTERP_END, '}}')
        this.pos += 2
        continue
      }

      if (char === '{') {
        this.pushToken(TokenType.LBRACE, '{')
        this.pos++
        continue
      }

      if (char === '}') {
        this.pushToken(TokenType.RBRACE, '}')
        this.pos++
        continue
      }

      if (char === '=' && this.source[this.pos + 1] === '>') {
        this.pushToken(TokenType.ARROW, '=>')
        this.pos += 2
        continue
      }

      if (char === '>' && this.source[this.pos + 1] === '=') {
        this.pushToken(TokenType.GTE, '>=')
        this.pos += 2
        continue
      }

      if (char === '<' && this.source[this.pos + 1] === '=') {
        this.pushToken(TokenType.LTE, '<=')
        this.pos += 2
        continue
      }

      // Compound assignment operators must be checked before their
      // single-char fallbacks below, same lookahead-before-fallback
      // pattern already used for '=>', '>=', '<=' above.
      if (char === '+' && this.source[this.pos + 1] === '=') {
        this.pushToken(TokenType.PLUS_EQUALS, '+=')
        this.pos += 2
        continue
      }

      if (char === '-' && this.source[this.pos + 1] === '=') {
        this.pushToken(TokenType.MINUS_EQUALS, '-=')
        this.pos += 2
        continue
      }

      if (char === '*' && this.source[this.pos + 1] === '=') {
        this.pushToken(TokenType.STAR_EQUALS, '*=')
        this.pos += 2
        continue
      }

      if (char === '/' && this.source[this.pos + 1] === '=') {
        this.pushToken(TokenType.SLASH_EQUALS, '/=')
        this.pos += 2
        continue
      }

      if (char === '+') {
        this.pushToken(TokenType.PLUS, '+')
        this.pos++
        continue
      }

      if (char === '-') {
        this.pushToken(TokenType.MINUS, '-')
        this.pos++
        continue
      }

      if (char === '*') {
        this.pushToken(TokenType.STAR, '*')
        this.pos++
        continue
      }

      if (char === '/') {
        this.pushToken(TokenType.SLASH, '/')
        this.pos++
        continue
      }

      if (char === '%') {
        this.pushToken(TokenType.PERCENT, '%')
        this.pos++
        continue
      }

      if (char === '?') {
        this.pushToken(TokenType.QUESTION, '?')
        this.pos++
        continue
      }

      if (char === '>') {
        this.pushToken(TokenType.GT, '>')
        this.pos++
        continue
      }

      if (char === '<') {
        this.pushToken(TokenType.LT, '<')
        this.pos++
        continue
      }

      if (char === '=') {
        this.pushToken(TokenType.EQUALS, '=')
        this.pos++
        continue
      }

      if (char in SINGLE_CHAR_TOKENS) {
        this.pushToken(SINGLE_CHAR_TOKENS[char], char)
        this.pos++
        continue
      }

      if (char === '`') {
        this.readTemplateLiteral()
        continue
      }

      if (char === '"' || char === "'") {
        this.readString(char)
        continue
      }

      if (/[0-9]/.test(char)) {
        this.readNumber()
        continue
      }

      if (/[a-zA-Z_$]/.test(char)) {
        this.readIdentifierOrKeyword()
        continue
      }

      throw new Error(`Unexpected character "${char}" at line ${this.line}`)
    }

    this.pushToken(TokenType.EOF, null)
    return this.tokens
  }

  skipWhitespaceAndComments() {
    while (this.pos < this.source.length) {
      const char = this.source[this.pos]

      if (char === '\n') {
        this.line++
        this.pos++
        continue
      }

      if (/\s/.test(char)) {
        this.pos++
        continue
      }

      if (char === '/' && this.source[this.pos + 1] === '/') {
        while (
          this.pos < this.source.length &&
          this.source[this.pos] !== '\n'
        ) {
          this.pos++
        }
        continue
      }

      if (char === '/' && this.source[this.pos + 1] === '*') {
        this.pos += 2
        while (
          this.pos < this.source.length &&
          !(this.source[this.pos] === '*' && this.source[this.pos + 1] === '/')
        ) {
          if (this.source[this.pos] === '\n') this.line++
          this.pos++
        }
        this.pos += 2
        continue
      }

      break
    }
  }

  readString(quoteChar) {
    const startLine = this.line
    this.pos++ // skip opening quote
    let value = ''
    while (
      this.pos < this.source.length &&
      this.source[this.pos] !== quoteChar
    ) {
      value += this.source[this.pos]
      this.pos++
    }
    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated string starting at line ${startLine}`)
    }
    this.pos++ // skip closing quote
    this.pushToken(TokenType.STRING, value, startLine)
  }

  // Scans a backtick template literal into a flat list of parts --
  // { type: "text", value } for literal text, { type: "expr", source }
  // for each ${...} span -- rather than re-entering full tokenization
  // mid-string. Each expr span's raw source gets parsed later via
  // parseExpressionString, reusing the same mechanism already used for
  // {{ }} interpolations and #if/#each headers, instead of teaching
  // the Lexer to interleave live token scanning inside a string.
  readTemplateLiteral() {
    const startLine = this.line
    this.pos++ // skip opening backtick
    const parts = []
    let textBuf = ''

    const flushText = () => {
      if (textBuf.length > 0) {
        parts.push({ type: 'text', value: textBuf })
        textBuf = ''
      }
    }

    while (true) {
      if (this.pos >= this.source.length) {
        throw new Error(
          `Unterminated template literal starting at line ${startLine}`,
        )
      }
      const char = this.source[this.pos]

      if (char === '`') {
        this.pos++ // skip closing backtick
        break
      }

      if (char === '$' && this.source[this.pos + 1] === '{') {
        flushText()
        this.pos += 2 // skip "${"
        const exprStart = this.pos
        let depth = 1
        while (this.pos < this.source.length && depth > 0) {
          if (this.source[this.pos] === '{') depth++
          else if (this.source[this.pos] === '}') depth--
          if (depth > 0) this.pos++
        }
        if (depth !== 0) {
          throw new Error(
            `Unterminated \${...} in template literal starting at line ${startLine}`,
          )
        }
        const exprSource = this.source.slice(exprStart, this.pos)
        this.pos++ // skip closing "}"
        parts.push({ type: 'expr', source: exprSource })
        continue
      }

      if (char === '\n') this.line++
      textBuf += char
      this.pos++
    }

    flushText()
    this.pushToken(TokenType.TEMPLATE_LITERAL, parts, startLine)
  }

  readNumber() {
    const start = this.pos
    while (
      this.pos < this.source.length &&
      /[0-9.]/.test(this.source[this.pos])
    ) {
      this.pos++
    }
    const text = this.source.slice(start, this.pos)
    this.pushToken(TokenType.NUMBER, Number(text))
  }

  readIdentifierOrKeyword() {
    const start = this.pos
    while (
      this.pos < this.source.length &&
      /[a-zA-Z0-9_$]/.test(this.source[this.pos])
    ) {
      this.pos++
    }
    const text = this.source.slice(start, this.pos)
    const type = KEYWORDS[text] ?? TokenType.IDENTIFIER
    this.pushToken(type, text)
  }

  pushToken(type, value, line = this.line) {
    this.tokens.push({ type, value, line })
  }
}
