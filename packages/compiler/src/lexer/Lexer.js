import { TokenType, KEYWORDS } from './tokenTypes.js'

const SINGLE_CHAR_TOKENS = {
  '(': TokenType.LPAREN,
  ')': TokenType.RPAREN,
  ':': TokenType.COLON,
  ',': TokenType.COMMA,
  ';': TokenType.SEMICOLON,
  '.': TokenType.DOT,
  '+': TokenType.PLUS,
  '-': TokenType.MINUS,
  '*': TokenType.STAR,
  '/': TokenType.SLASH,
  '>': TokenType.GT,
  '<': TokenType.LT,
  '[': TokenType.LBRACKET,
  ']': TokenType.RBRACKET,
}

/**
 * Tokenizes Tylix's .tyx language: the top-level script sections
 * (page/state/action/computed/watch keywords, identifiers, numbers,
 * strings) plus the special {{ }} interpolation markers used inside
 * template blocks.
 */
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
