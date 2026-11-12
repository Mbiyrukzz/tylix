import { TokenType, KEYWORDS } from './tokenTypes.js'

const T = TokenType

// Identifier characters follow the JS spec (Unicode ID_Start /
// ID_Continue plus $ and _), so names like `café` or `変数` work.
const ID_START = /^[\p{ID_Start}_$]$/u
const ID_PART = /^[\p{ID_Continue}$\u200c\u200d]$/u

// The whole code point at index i (handles surrogate pairs), or ''.
function codePointStringAt(src, i) {
  const cp = src.codePointAt(i)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}

// Multi-character operators, matched longest-first. JS-style spellings
// of Tylix word operators are aliased here:
//   == / ===  -> is        != / !==  -> is not
//   &&        -> and       ||        -> or
// (equality is always strict.)
//
// Shifts (<< >> >>>) and their compound forms are deliberately NOT in
// this table: they come out as adjacent LT/GT/LTE/GTE tokens so that
// nested generics like Array<Array<T>> still close, and the Parser
// recombines them in expression context.
const MULTI_CHAR_OPERATORS = [
  ['??=', [[T.NULLISH_EQUALS, '??=']]],
  ['**=', [[T.STAR_STAR_EQUALS, '**=']]],
  ['||=', [[T.OR_EQUALS, '||=']]],
  ['&&=', [[T.AND_EQUALS, '&&=']]],
  ['...', [[T.SPREAD, '...']]],
  ['===', [[T.IS, 'is']]],
  [
    '!==',
    [
      [T.IS, 'is'],
      [T.NOT, 'not'],
    ],
  ],
  ['=>', [[T.ARROW, '=>']]],
  ['==', [[T.IS, 'is']]],
  [
    '!=',
    [
      [T.IS, 'is'],
      [T.NOT, 'not'],
    ],
  ],
  ['>=', [[T.GTE, '>=']]],
  ['<=', [[T.LTE, '<=']]],
  ['&&', [[T.AND, 'and']]],
  ['||', [[T.OR, 'or']]],
  ['??', [[T.NULLISH, '??']]],
  ['++', [[T.PLUS_PLUS, '++']]],
  ['--', [[T.MINUS_MINUS, '--']]],
  ['**', [[T.STAR_STAR, '**']]],
  ['+=', [[T.PLUS_EQUALS, '+=']]],
  ['-=', [[T.MINUS_EQUALS, '-=']]],
  ['*=', [[T.STAR_EQUALS, '*=']]],
  ['/=', [[T.SLASH_EQUALS, '/=']]],
  ['%=', [[T.PERCENT_EQUALS, '%=']]],
  ['&=', [[T.AMP_EQUALS, '&=']]],
  ['|=', [[T.PIPE_EQUALS, '|=']]],
  ['^=', [[T.CARET_EQUALS, '^=']]],
].sort((a, b) => b[0].length - a[0].length)

const SINGLE_CHAR_TOKENS = new Map([
  ['(', [T.LPAREN, '(']],
  [')', [T.RPAREN, ')']],
  ['{', [T.LBRACE, '{']],
  ['}', [T.RBRACE, '}']],
  ['[', [T.LBRACKET, '[']],
  [']', [T.RBRACKET, ']']],
  [':', [T.COLON, ':']],
  [',', [T.COMMA, ',']],
  [';', [T.SEMICOLON, ';']],
  ['.', [T.DOT, '.']],
  ['=', [T.EQUALS, '=']],
  ['+', [T.PLUS, '+']],
  ['-', [T.MINUS, '-']],
  ['*', [T.STAR, '*']],
  ['/', [T.SLASH, '/']],
  ['%', [T.PERCENT, '%']],
  ['>', [T.GT, '>']],
  ['<', [T.LT, '<']],
  ['?', [T.QUESTION, '?']],
  ['|', [T.PIPE, '|']],
  ['&', [T.AMP, '&']],
  ['^', [T.CARET, '^']],
  ['~', [T.TILDE, '~']],
  ['!', [T.NOT, '!']],
])

// Tokens after which a "/" starts a regex literal (or a "." starts a
// number like .5) rather than being division / member access. After
// an identifier, number, string, ")" or "]" it is division instead.
const REGEX_PRECEDERS = new Set([
  T.LPAREN,
  T.LBRACKET,
  T.LBRACE,
  T.COMMA,
  T.COLON,
  T.SEMICOLON,
  T.EQUALS,
  T.ARROW,
  T.QUESTION,
  T.NULLISH,
  T.NULLISH_EQUALS,
  T.PLUS,
  T.MINUS,
  T.STAR,
  T.SLASH,
  T.PERCENT,
  T.STAR_STAR,
  T.GT,
  T.LT,
  T.GTE,
  T.LTE,
  T.PLUS_EQUALS,
  T.MINUS_EQUALS,
  T.STAR_EQUALS,
  T.SLASH_EQUALS,
  T.PERCENT_EQUALS,
  T.STAR_STAR_EQUALS,
  T.OR_EQUALS,
  T.AND_EQUALS,
  T.AMP_EQUALS,
  T.PIPE_EQUALS,
  T.CARET_EQUALS,
  T.PIPE,
  T.AMP,
  T.CARET,
  T.TILDE,
  T.AND,
  T.OR,
  T.NOT,
  T.IS,
  T.HAS,
  T.IN,
  T.OF,
  T.IF,
  T.ELSE,
  T.DO,
  T.WHILE,
  T.SWITCH,
  T.INSTANCEOF,
  T.RETURN,
  T.AWAIT,
  T.TYPEOF,
  T.DELETE,
  T.VOID,
  T.THROW,
  T.CASE,
  T.SPREAD,
])

export class Lexer {
  constructor(source) {
    this.source = source
    this.pos = 0
    this.line = 1
    this.tokens = []
    this.tokenStart = 0
  }

  tokenize() {
    const src = this.source

    while (this.pos < src.length) {
      this.skipWhitespaceAndComments()
      if (this.pos >= src.length) break

      this.tokenStart = this.pos
      const char = src[this.pos]

      // NOTE: "{{" and "}}" are intentionally NOT tokenized. Template
      // interpolations are located at the string level by parseTemplate;
      // tokenizing them broke object literals like {a:{b:1}}.

      if (char === '/' && this.regexAllowed()) {
        this.readRegex()
        continue
      }

      if (
        char === '.' &&
        /[0-9]/.test(src[this.pos + 1] ?? '') &&
        this.regexAllowed()
      ) {
        this.readNumber() // .5
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

      // Identifiers: any Unicode ID_Start character, or `#name` (a
      // class private name, lexed as one identifier token).
      const ch = codePointStringAt(src, this.pos)
      if (
        ID_START.test(ch) ||
        (ch === '#' && ID_START.test(codePointStringAt(src, this.pos + 1)))
      ) {
        this.readIdentifierOrKeyword()
        continue
      }

      const multi = MULTI_CHAR_OPERATORS.find(([op]) =>
        src.startsWith(op, this.pos),
      )
      if (multi) {
        for (const [type, value] of multi[1]) this.pushToken(type, value)
        this.pos += multi[0].length
        continue
      }

      // Optional chaining, but not the ternary in `a?.5:1`
      if (
        char === '?' &&
        src[this.pos + 1] === '.' &&
        !/[0-9]/.test(src[this.pos + 2] ?? '')
      ) {
        this.pushToken(T.QUESTION_DOT, '?.')
        this.pos += 2
        continue
      }

      const single = SINGLE_CHAR_TOKENS.get(char)
      if (single) {
        this.pushToken(single[0], single[1])
        this.pos++
        continue
      }

      throw new Error(`Unexpected character "${char}" at line ${this.line}`)
    }

    this.tokenStart = this.pos
    this.pushToken(T.EOF, null)
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

  // True when a "/" (or a ".5") at the current position should start a
  // regex literal (or number) based on the previous token.
  regexAllowed() {
    const prev = this.tokens[this.tokens.length - 1]
    if (!prev) return true
    // A keyword right after "." is a property name (`obj.in / 2`),
    // so the "/" is division, not the start of a regex.
    const before = this.tokens[this.tokens.length - 2]
    if (before && (before.type === T.DOT || before.type === T.QUESTION_DOT)) {
      return false
    }
    // `yield /re/` -- yield is a plain identifier token.
    if (prev.type === T.IDENTIFIER && prev.value === 'yield') return true
    return REGEX_PRECEDERS.has(prev.type)
  }

  readRegex() {
    const src = this.source
    const startLine = this.line
    this.pos++ // opening "/"
    const bodyStart = this.pos
    let inClass = false
    while (this.pos < src.length) {
      const c = src[this.pos]
      if (c === '\n') break
      if (c === '\\') {
        this.pos += 2
        continue
      }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) break
      this.pos++
    }
    if (src[this.pos] !== '/') {
      throw new Error(`Unterminated regular expression at line ${startLine}`)
    }
    const pattern = src.slice(bodyStart, this.pos)
    this.pos++ // closing "/"
    const flagStart = this.pos
    while (/[a-z]/.test(src[this.pos] ?? '')) this.pos++
    const flags = src.slice(flagStart, this.pos)
    this.pushToken(T.REGEX, { pattern, flags }, startLine)
  }

  // Called with this.pos on the backslash. Consumes the escape
  // sequence and returns the character(s) it stands for. Supports the
  // usual \n \t \r \b \f \v \0, hex \xNN, unicode \uNNNN and \u{...},
  // and line continuations. Unknown escapes (\\, \', \", \`, \$) just
  // yield the escaped character.
  readEscape() {
    const src = this.source
    this.pos++ // skip '\'
    const c = src[this.pos]
    if (c === undefined) return ''
    this.pos++
    switch (c) {
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'r':
        return '\r'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case 'v':
        return '\v'
      case '0':
        return '\0'
      case 'x': {
        const hex = src.slice(this.pos, this.pos + 2)
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          this.pos += 2
          return String.fromCharCode(parseInt(hex, 16))
        }
        return 'x'
      }
      case 'u': {
        if (src[this.pos] === '{') {
          const close = src.indexOf('}', this.pos)
          const hex = close === -1 ? '' : src.slice(this.pos + 1, close)
          if (/^[0-9a-fA-F]+$/.test(hex)) {
            const code = parseInt(hex, 16)
            if (code > 0x10ffff) {
              throw new Error(
                `Invalid unicode escape \\u{${hex}} at line ${this.line}`,
              )
            }
            this.pos = close + 1
            return String.fromCodePoint(code)
          }
          return 'u'
        }
        const hex = src.slice(this.pos, this.pos + 4)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.pos += 4
          return String.fromCharCode(parseInt(hex, 16))
        }
        return 'u'
      }
      case '\r':
        if (src[this.pos] === '\n') this.pos++
        this.line++ // line continuation
        return ''
      case '\n':
        this.line++ // line continuation
        return ''
      default:
        return c
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
      if (this.source[this.pos] === '\\') {
        value += this.readEscape()
        continue
      }
      if (this.source[this.pos] === '\n') this.line++
      value += this.source[this.pos]
      this.pos++
    }
    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated string starting at line ${startLine}`)
    }
    this.pos++ // skip closing quote
    this.pushToken(T.STRING, value, startLine)
  }

  // Scans a backtick template literal into a flat list of parts --
  // { type: "text", value, raw } for literal text, { type: "expr",
  // source } for each ${...} span -- rather than re-entering full
  // tokenization mid-string. `value` is the cooked text (escapes
  // resolved); `raw` is the text exactly as written, which tagged
  // templates need for String.raw. Each expr span's raw source gets
  // parsed later via parseExpressionString.
  readTemplateLiteral() {
    const src = this.source
    const startLine = this.line
    this.pos++ // skip opening backtick
    const parts = []
    let textBuf = ''
    let rawBuf = ''

    const flushText = () => {
      if (textBuf.length > 0 || rawBuf.length > 0) {
        parts.push({ type: 'text', value: textBuf, raw: rawBuf })
        textBuf = ''
        rawBuf = ''
      }
    }

    while (true) {
      if (this.pos >= src.length) {
        throw new Error(
          `Unterminated template literal starting at line ${startLine}`,
        )
      }
      const char = src[this.pos]

      if (char === '`') {
        this.pos++ // skip closing backtick
        break
      }

      if (char === '\\') {
        const escStart = this.pos
        textBuf += this.readEscape()
        rawBuf += src.slice(escStart, this.pos)
        continue
      }

      if (char === '$' && src[this.pos + 1] === '{') {
        flushText()
        this.pos += 2 // skip "${"
        const exprStart = this.pos
        const exprEnd = this.findTemplateExprEnd(exprStart)
        if (exprEnd === -1) {
          throw new Error(
            `Unterminated \${...} in template literal starting at line ${startLine}`,
          )
        }
        const exprSource = src.slice(exprStart, exprEnd)
        // Newlines inside the span still count toward line numbers.
        this.line += (exprSource.match(/\n/g) ?? []).length
        this.pos = exprEnd + 1 // skip closing "}"
        parts.push({ type: 'expr', source: exprSource })
        continue
      }

      if (char === '\n') this.line++
      textBuf += char
      rawBuf += char
      this.pos++
    }

    flushText()
    this.pushToken(T.TEMPLATE_LITERAL, parts, startLine)
  }

  // Index of the "}" that closes a ${ ... } span starting at `from`.
  // Braces inside strings and nested template literals are skipped,
  // so ${ "}" } and ${ `a${b}` } work.
  findTemplateExprEnd(from) {
    const src = this.source
    let depth = 1
    let i = from
    while (i < src.length) {
      const c = src[i]
      if (c === '"' || c === "'") {
        i++
        while (i < src.length && src[i] !== c) {
          if (src[i] === '\\') i++
          i++
        }
        i++
        continue
      }
      if (c === '`') {
        i = this.skipNestedTemplate(i)
        if (i === -1) return -1
        continue
      }
      if (c === '{') {
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0) return i
      }
      i++
    }
    return -1
  }

  // `i` points at an opening backtick. Returns the index just past
  // the matching closing backtick, or -1 if it never closes.
  skipNestedTemplate(i) {
    const src = this.source
    i++
    while (i < src.length) {
      const c = src[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') return i + 1
      if (c === '$' && src[i + 1] === '{') {
        const end = this.findTemplateExprEnd(i + 2)
        if (end === -1) return -1
        i = end + 1
        continue
      }
      i++
    }
    return -1
  }

  // Numbers: 42, 3.14, .5, 1_000, 1e6, 2.5e-3, 0xFF, 0b101, 0o17,
  // BigInt (10n, 0xFFn) and durations (500ms, 2s, 5m, 1h, 7d). A "."
  // is only part of the number when a digit follows, so
  // `1.5.toFixed(1)` still works.
  readNumber() {
    const src = this.source
    const start = this.pos
    const isDigit = (c) => /[0-9_]/.test(c ?? '')
    const isIdentChar = (c) => /[A-Za-z0-9_$]/.test(c ?? '')
    const bigIntSuffix = () =>
      src[this.pos] === 'n' && !isIdentChar(src[this.pos + 1])

    // 0xFF, 0b101, 0o17
    if (src[this.pos] === '0' && /[xXbBoO]/.test(src[this.pos + 1] ?? '')) {
      this.pos += 2
      while (/[0-9a-fA-F_]/.test(src[this.pos] ?? '')) this.pos++
      const text = src.slice(start, this.pos).replace(/_/g, '')
      if (bigIntSuffix()) {
        this.pos++
        this.pushToken(T.BIGINT, text)
        return
      }
      this.pushToken(T.NUMBER, Number(text))
      return
    }

    let isInteger = true
    while (isDigit(src[this.pos])) this.pos++
    if (src[this.pos] === '.' && /[0-9]/.test(src[this.pos + 1] ?? '')) {
      isInteger = false
      this.pos++
      while (isDigit(src[this.pos])) this.pos++
    }
    // exponent: 1e6, 2.5e-3
    if (/^[eE][+-]?[0-9]/.test(src.slice(this.pos, this.pos + 3))) {
      isInteger = false
      this.pos += 2
      while (isDigit(src[this.pos])) this.pos++
    }
    const text = src.slice(start, this.pos).replace(/_/g, '')

    if (isInteger && bigIntSuffix()) {
      this.pos++
      this.pushToken(T.BIGINT, text)
      return
    }

    const unitMatch = /^(ms|s|m|h|d)/.exec(src.slice(this.pos))
    if (
      unitMatch &&
      !/[A-Za-z0-9_$]/.test(src[this.pos + unitMatch[0].length] ?? '')
    ) {
      const unit = unitMatch[0]
      this.pos += unit.length
      this.pushToken(T.DURATION, `${text}${unit}`)
      return
    }

    this.pushToken(T.NUMBER, Number(text))
  }

  readIdentifierOrKeyword() {
    const src = this.source
    const start = this.pos
    if (src[this.pos] === '#') this.pos++ // private name: #field
    while (this.pos < src.length) {
      const ch = codePointStringAt(src, this.pos)
      if (!ID_PART.test(ch)) break
      this.pos += ch.length
    }
    const text = src.slice(start, this.pos)
    // Own-property lookup only: a plain `KEYWORDS[text]` also finds
    // inherited names, so `toString`, `constructor` and
    // `hasOwnProperty` used to come out as function "token types".
    const type =
      !text.startsWith('#') && Object.hasOwn(KEYWORDS, text)
        ? KEYWORDS[text]
        : T.IDENTIFIER
    this.pushToken(type, text)
  }

  // `start` is the source offset where the current token began; the
  // Parser uses it to tell whether two tokens were written adjacent
  // (">" ">" is a shift, "> >" is not).
  pushToken(type, value, line = this.line) {
    this.tokens.push({ type, value, line, start: this.tokenStart })
  }
}