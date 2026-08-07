import { TokenType, KEYWORDS } from '../lexer/tokenTypes.js'
import {
  PageNode,
  PropNode,
  StateNode,
  MethodNode,
  AssignmentExpr,
  BinaryExpr,
  UnaryExpr,
  TernaryExpr,
  NullishCoalescingExpr,
  ArrowFunctionExpr,
  TemplateLiteralExpr,
  SpreadElement,
  Identifier,
  MemberExpr,
  Literal,
  ReturnStatement,
  ExpressionStatement,
  CallExpr,
  NewExpr,
  AwaitExpr,
  VariableDeclaration,
  ObjectExpr,
  ArrayExpr,
  ObjectPattern,
  ArrayPattern,
  TryStatement,
  IfStatement,
  ForInStatement,
  ForRangeStatement,
  RepeatStatement,
  BreakStatement,
  ContinueStatement,
  CapabilityRefNode,
  MetaEntryNode,
} from '../ast/nodes.js'
import { parseExpressionString } from './parseExpressionString.js'

const COMPARISON_SYMBOLS = {
  [TokenType.GT]: '>',
  [TokenType.LT]: '<',
  [TokenType.GTE]: '>=',
  [TokenType.LTE]: '<=',
}

const ADDITIVE_SYMBOLS = {
  [TokenType.PLUS]: '+',
  [TokenType.MINUS]: '-',
}

const MULTIPLICATIVE_SYMBOLS = {
  [TokenType.STAR]: '*',
  [TokenType.SLASH]: '/',
  [TokenType.PERCENT]: '%',
}

const KEYWORD_TOKEN_TYPES = new Set(Object.values(KEYWORDS))

// Compound assignment desugars at parse time into a plain
// AssignmentExpression whose value is a BinaryExpression -- e.g.
// `this.count += 1` becomes exactly the same AST as if the dev had
// written `this.count = this.count + 1`, so no codegen changes are
// needed at all; generateExpression already knows how to emit both
// node types.
const COMPOUND_ASSIGNMENT_OPS = {
  [TokenType.PLUS_EQUALS]: '+',
  [TokenType.MINUS_EQUALS]: '-',
  [TokenType.STAR_EQUALS]: '*',
  [TokenType.SLASH_EQUALS]: '/',
}

/**
 * Parses the token stream from the Lexer into a Page AST.
 *
 * Expressions are parsed with real precedence-climbing, low to high:
 *   arrow function (x => expr, (a, b) => expr) -- tried first, with
 *     backtracking, since it can start with the same tokens as a
 *     grouped expression or a bare identifier
 *   assignment  (= += -= *= /=)
 *   ternary     (?:)
 *   logical or  (or)
 *   logical and (and)
 *   equality    (is / is not)
 *   comparison  (> < >= <=)
 *   predicate   (has / exists / missing)
 *   additive    (+ -)
 *   multiplicative (* / %)
 *   unary       (not, -, await)
 *   member/call (a.b, a())
 *   primary     (literals, identifiers, grouping, arrays, objects,
 *                template literals)
 */
export class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.pos = 0
  }

  parse() {
    const page = {
      props: [],
      state: [],
      computed: [],
      actions: [],
      uses: [],
      onMount: null,
    }

    while (!this.check(TokenType.EOF)) {
      if (this.match(TokenType.PROPS)) {
        page.props = this.parseSectionBlock(this.parsePropEntry.bind(this))
      } else if (this.match(TokenType.STATE)) {
        page.state = this.parseSectionBlock(this.parseStateEntry.bind(this))
      } else if (this.match(TokenType.COMPUTED)) {
        page.computed = this.parseSectionBlock(this.parseMethod.bind(this))
      } else if (this.match(TokenType.USES)) {
        page.uses = this.parseSectionBlock(this.parseUsesEntry.bind(this))
      } else if (this.match(TokenType.ACTION)) {
        page.actions = this.parseSectionBlock(this.parseMethod.bind(this))
      } else if (this.check(TokenType.ONMOUNT)) {
        const startLine = this.peek().line
        this.advance()
        page.onMount = { ...this.parseOnMountBody(), line: startLine }
      } else if (this.match(TokenType.TITLE)) {
        page.title = this.expect(
          TokenType.STRING,
          "Expected a string after 'title'",
        ).value
      } else if (this.match(TokenType.LAYOUT)) {
        page.layout = this.expect(
          TokenType.IDENTIFIER,
          'Expected a layout component name',
        ).value
      } else if (this.match(TokenType.NEEDS)) {
        page.needs = this.parseSectionBlock(this.parseUsesEntry.bind(this))
      } else if (this.match(TokenType.PREFETCH)) {
        page.prefetch = this.parseSectionBlock(
          this.parseCapabilityRefEntry.bind(this),
        )
      } else if (this.match(TokenType.BACKGROUND)) {
        page.background = this.parseSectionBlock(this.parseUsesEntry.bind(this))
      } else if (this.match(TokenType.PERMISSIONS)) {
        page.permissions = this.parseSectionBlock(
          this.parsePermissionEntry.bind(this),
        )
      } else if (this.match(TokenType.META)) {
        page.meta = this.parseSectionBlock(this.parseMetaEntry.bind(this))
      } else {
        throw new Error(
          `Unexpected token ${this.peek().type} at line ${this.peek().line}`,
        )
      }
    }

    return PageNode(page)
  }

  parseOnMountBody() {
    const isAsync = this.match(TokenType.ASYNC)
    if (this.check(TokenType.LBRACE)) {
      this.expect(TokenType.LBRACE, "Expected '{' to start onMount body")
      const body = []
      while (!this.check(TokenType.RBRACE)) {
        body.push(this.parseStatement())
      }
      this.expect(TokenType.RBRACE, "Expected '}' to close onMount body")
      return { body, isAsync }
    }
    const body = []
    while (!this.isAtSectionBoundary()) {
      body.push(this.parseStatement())
    }
    return { body, isAsync }
  }

  parseSectionBlock(parseEntry) {
    if (this.check(TokenType.LBRACE)) {
      return this.parseBlock(parseEntry)
    }
    return this.parseBareBlock(parseEntry)
  }

  parseBlock(parseEntry) {
    this.expect(TokenType.LBRACE, "Expected '{' to start block")
    const entries = []
    while (!this.check(TokenType.RBRACE)) {
      entries.push(parseEntry())
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close block")
    return entries
  }

  isSectionKeyword(type) {
    return (
      type === TokenType.PROPS ||
      type === TokenType.USES ||
      type === TokenType.STATE ||
      type === TokenType.COMPUTED ||
      type === TokenType.ACTION ||
      type === TokenType.ONMOUNT ||
      type === TokenType.INIT ||
      type === TokenType.EOF
    )
  }

  // These five double as ordinary field names in practice (title
  // especially), so unlike the keywords above they can't be trusted as
  // section boundaries on token type alone -- isAtSectionBoundary below
  // checks the following token to disambiguate.
  isAmbiguousSectionKeyword(type) {
    return (
      type === TokenType.TITLE ||
      type === TokenType.LAYOUT ||
      type === TokenType.NEEDS ||
      type === TokenType.PREFETCH ||
      type === TokenType.BACKGROUND ||
      type === TokenType.PERMISSIONS ||
      type === TokenType.META
    )
  }

  isAtSectionBoundary() {
    const type = this.peek().type
    if (this.isSectionKeyword(type)) return true
    if (this.isAmbiguousSectionKeyword(type)) {
      const next = this.tokens[this.pos + 1]
      // Followed by ':' or '(' means it's a field/prop/method name in
      // the CURRENT block (e.g. `title: ""`, `title(Type): ""`), not
      // the start of a new section.
      return !(
        next &&
        (next.type === TokenType.COLON || next.type === TokenType.LPAREN)
      )
    }
    return false
  }

  parseBareBlock(parseEntry) {
    const entries = []
    while (!this.isAtSectionBoundary()) {
      entries.push(parseEntry())
      this.match(TokenType.COMMA)
    }
    return entries
  }

  // Shared by parseStateEntry/parsePropEntry/parseMethod: a keyword
  // token (title, layout, needs, etc.) is a perfectly valid field/prop/
  // method name once we're past the section-boundary check above --
  // same allowance parsePropertyName already makes for `.title` access.
  parseNameToken(message) {
    const token = this.peek()
    if (
      token.type === TokenType.IDENTIFIER ||
      KEYWORD_TOKEN_TYPES.has(token.type)
    ) {
      this.advance()
      return token.value
    }
    throw new Error(`${message} at line ${token.line}, got ${token.type}`)
  }

  parsePropEntry() {
    const startLine = this.peek().line
    const name = this.expect(TokenType.IDENTIFIER, 'Expected prop name').value
    const optional = this.match(TokenType.QUESTION)
    this.expect(TokenType.COLON, "Expected ':' after prop name")
    const propType = this.parseTypeExpression()
    return { ...PropNode(name, propType, optional), line: startLine }
  }

  parseUsesEntry() {
    const startLine = this.peek().line
    const token = this.expect(TokenType.IDENTIFIER, 'Expected capability name')
    const name = token.value
    if (!/^[A-Z]/.test(name)) {
      throw new Error(
        `Capability name "${name}" must start with an uppercase letter (line ${startLine})`,
      )
    }
    return { name, line: startLine }
  }

  parseCapabilityRefEntry() {
    const startLine = this.peek().line
    const capability = this.expect(
      TokenType.IDENTIFIER,
      'Expected a capability name',
    ).value
    this.expect(
      TokenType.DOT,
      "Expected '.' after capability name in prefetch entry",
    )
    const member = this.parsePropertyName("after '.'")
    let args = null
    if (this.check(TokenType.LPAREN)) {
      args = this.parseCallArguments()
    }
    return { ...CapabilityRefNode(capability, member, args), line: startLine }
  }

  parsePermissionEntry() {
    const startLine = this.peek().line
    let name = this.expect(
      TokenType.IDENTIFIER,
      'Expected a permission name',
    ).value
    while (this.match(TokenType.DOT)) {
      name += '.' + this.parsePropertyName("after '.'")
    }
    return { name, line: startLine }
  }

  parseMetaEntry() {
    const startLine = this.peek().line
    const key = this.expect(TokenType.IDENTIFIER, 'Expected a meta key').value
    let value
    if (
      this.check(TokenType.STRING) ||
      this.check(TokenType.NUMBER) ||
      this.check(TokenType.DURATION)
    ) {
      value = this.advance().value
    } else if (this.check(TokenType.IDENTIFIER)) {
      // true / false, lexed as identifiers per parsePrimary's convention
      const raw = this.advance().value
      value = raw === 'true' ? true : raw === 'false' ? false : raw
    } else {
      throw new Error(`Expected a meta value at line ${this.peek().line}`)
    }
    return { ...MetaEntryNode(key, value), line: startLine }
  }

  parseStateEntry() {
    const startLine = this.peek().line
    const name = this.parseNameToken('Expected state name')

    let typeAnnotation = null
    if (this.match(TokenType.LPAREN)) {
      typeAnnotation = this.parseTypeExpression()
      this.expect(
        TokenType.RPAREN,
        "Expected ')' to close state type annotation",
      )
    }

    this.expect(TokenType.COLON, "Expected ':' after state name")
    if (this.match(TokenType.MINUS)) {
      const num = this.expect(
        TokenType.NUMBER,
        "Expected a number after '-'",
      ).value
      return {
        ...StateNode(name, Literal(-num), typeAnnotation),
        line: startLine,
      }
    }
    const value = this.parsePrimary()
    return { ...StateNode(name, value, typeAnnotation), line: startLine }
  }

  parseMethod() {
    const startLine = this.peek().line
    const isAsync = this.match(TokenType.ASYNC)
    const name = this.parseNameToken('Expected method name')
    this.expect(TokenType.LPAREN, "Expected '(' after method name")

    const params = []
    while (!this.check(TokenType.RPAREN)) {
      const paramName = this.expect(
        TokenType.IDENTIFIER,
        'Expected parameter name',
      ).value
      let paramType = null
      if (this.match(TokenType.COLON)) {
        paramType = this.parseTypeExpression()
      }
      params.push({ name: paramName, typeAnnotation: paramType })
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RPAREN, "Expected ')' after parameters")

    let returnType = null
    if (this.match(TokenType.COLON)) {
      returnType = this.parseTypeExpression()
    }

    this.expect(TokenType.LBRACE, "Expected '{' to start method body")
    const body = []
    while (!this.check(TokenType.RBRACE)) {
      body.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close method body")

    return {
      ...MethodNode(name, params, body, returnType),
      isAsync,
      line: startLine,
    }
  }
  // A binding target is anywhere a name is bound to a value: a plain
  // identifier, or -- for destructuring -- a nested object/array
  // pattern. Shared by top-level const/let targets, object pattern
  // property values, and array pattern elements, so `const { a: { b } }
  // = x` and `const [[a, b]] = x` both fall out for free instead of
  // needing separate one-level-deep parsing logic in three places.
  parseBindingTarget() {
    if (this.check(TokenType.LBRACE)) return this.parseObjectPattern()
    if (this.check(TokenType.LBRACKET)) return this.parseArrayPattern()
    return this.expect(TokenType.IDENTIFIER, 'Expected a binding name').value
  }

  parseObjectPattern() {
    this.expect(TokenType.LBRACE, "Expected '{' to start destructuring pattern")
    const properties = []
    let rest = null
    while (!this.check(TokenType.RBRACE)) {
      if (this.match(TokenType.SPREAD)) {
        rest = this.expect(
          TokenType.IDENTIFIER,
          "Expected identifier after '...'",
        ).value
        this.match(TokenType.COMMA)
        continue
      }
      const key = this.expect(
        TokenType.IDENTIFIER,
        'Expected a property name',
      ).value
      let binding = key
      if (this.match(TokenType.COLON)) {
        binding = this.parseBindingTarget()
      }
      let defaultValue = null
      if (this.match(TokenType.EQUALS)) {
        defaultValue = this.parseAssignment()
      }
      properties.push({ key, binding, defaultValue })
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close destructuring pattern")
    return ObjectPattern(properties, rest)
  }

  parseArrayPattern() {
    this.expect(
      TokenType.LBRACKET,
      "Expected '[' to start array destructuring pattern",
    )
    const elements = []
    let rest = null
    while (!this.check(TokenType.RBRACKET)) {
      if (this.match(TokenType.SPREAD)) {
        rest = this.expect(
          TokenType.IDENTIFIER,
          "Expected identifier after '...'",
        ).value
        this.match(TokenType.COMMA)
        continue
      }
      // A bare comma (or an immediate closing bracket after a comma)
      // is a skipped slot -- `const [, second] = arr` -- distinct from
      // a binding target. Checked before parseBindingTarget() so a
      // hole doesn't fall through to "Expected a binding name".
      if (this.check(TokenType.COMMA)) {
        elements.push(null)
        this.advance()
        continue
      }
      const binding = this.parseBindingTarget()
      let defaultValue = null
      if (this.match(TokenType.EQUALS)) {
        defaultValue = this.parseAssignment()
      }
      elements.push({ binding, defaultValue })
      this.match(TokenType.COMMA)
    }
    this.expect(
      TokenType.RBRACKET,
      "Expected ']' to close array destructuring pattern",
    )
    return ArrayPattern(elements, rest)
  }

  parsePropertyName(context) {
    const token = this.peek()
    if (
      token.type === TokenType.IDENTIFIER ||
      KEYWORD_TOKEN_TYPES.has(token.type)
    ) {
      this.advance()
      return token.value
    }
    throw new Error(
      `Expected a property name ${context} at line ${token.line}, got ${token.type}`,
    )
  }

  parseStatement() {
    const startLine = this.peek().line
    const node = this.parseStatementInner()
    node.line = node.line ?? startLine
    return node
  }

  // Parses a capability.tyx file: `capability Name` header, then
  // state/action/init sections. Structurally similar to parse(), but
  // deliberately separate rather than unified -- a capability has no
  // props, no template, and `init` (not `onMount`) is its only
  // lifecycle hook, so sharing parse()'s isSectionKeyword/loop would
  // mean threading capability-only exceptions through page-only logic.
  parseCapability() {
    this.expect(TokenType.CAPABILITY, "Expected 'capability'")
    const name = this.expect(
      TokenType.IDENTIFIER,
      'Expected capability name',
    ).value

    const capability = { name, state: [], actions: [], init: null }

    while (!this.check(TokenType.EOF)) {
      if (this.match(TokenType.STATE)) {
        capability.state = this.parseSectionBlock(
          this.parseStateEntry.bind(this),
        )
      } else if (this.match(TokenType.ACTION)) {
        capability.actions = this.parseSectionBlock(this.parseMethod.bind(this))
      } else if (this.check(TokenType.INIT)) {
        const startLine = this.peek().line
        this.advance()
        capability.init = { ...this.parseOnMountBody(), line: startLine }
      } else {
        throw new Error(
          `Unexpected token ${this.peek().type} at line ${this.peek().line}`,
        )
      }
    }

    return capability
  }

  parseStatementInner() {
    if (this.match(TokenType.RETURN)) {
      const hasValue =
        !this.check(TokenType.SEMICOLON) && !this.check(TokenType.RBRACE)
      const argument = hasValue ? this.parseExpression() : null
      this.match(TokenType.SEMICOLON)
      return ReturnStatement(argument)
    }

    if (this.match(TokenType.IF)) {
      return this.parseIfStatement()
    }

    if (this.match(TokenType.FOR)) {
      return this.parseForStatement()
    }

    if (this.match(TokenType.REPEAT)) {
      return this.parseRepeatStatement()
    }

    if (this.match(TokenType.TRY)) {
      return this.parseTryStatement()
    }

    if (this.match(TokenType.BREAK)) {
      this.match(TokenType.SEMICOLON)
      return BreakStatement()
    }

    if (this.match(TokenType.CONTINUE)) {
      this.match(TokenType.SEMICOLON)
      return ContinueStatement()
    }

    if (this.check(TokenType.CONST) || this.check(TokenType.LET)) {
      const kind = this.advance().type === TokenType.CONST ? 'const' : 'let'
      const target = this.parseBindingTarget()
      this.expect(TokenType.EQUALS, "Expected '=' in variable declaration")
      const init = this.parseExpression()
      this.match(TokenType.SEMICOLON)
      return VariableDeclaration(kind, target, init)
    }

    const expression = this.parseExpression()
    this.match(TokenType.SEMICOLON)
    return ExpressionStatement(expression)
  }
  parseIfStatement() {
    const hasParen = this.match(TokenType.LPAREN)
    const condition = this.parseExpression()
    if (hasParen) {
      this.expect(TokenType.RPAREN, "Expected ')' after if condition")
    }
    this.expect(TokenType.LBRACE, "Expected '{' to start if body")
    const consequent = []
    while (!this.check(TokenType.RBRACE)) {
      consequent.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close if body")

    let alternate = null
    if (this.match(TokenType.ELSE)) {
      if (this.check(TokenType.IF)) {
        this.advance()
        alternate = [this.parseIfStatement()]
      } else {
        this.expect(TokenType.LBRACE, "Expected '{' to start else body")
        alternate = []
        while (!this.check(TokenType.RBRACE)) {
          alternate.push(this.parseStatement())
        }
        this.expect(TokenType.RBRACE, "Expected '}' to close else body")
      }
    }

    return IfStatement(condition, consequent, alternate)
  }

  parseForStatement() {
    const varName = this.expect(
      TokenType.IDENTIFIER,
      "Expected a loop variable name after 'for'",
    ).value

    if (this.match(TokenType.IN)) {
      const iterable = this.parseExpression()
      this.expect(TokenType.LBRACE, "Expected '{' to start the loop body")
      const body = []
      while (!this.check(TokenType.RBRACE)) {
        body.push(this.parseStatement())
      }
      this.expect(TokenType.RBRACE, "Expected '}' to close the loop body")
      return ForInStatement(varName, iterable, body)
    }

    if (this.match(TokenType.FROM)) {
      const start = this.parseExpression()
      this.expect(TokenType.TO, "Expected 'to' after the loop's starting value")
      const end = this.parseExpression()
      this.expect(TokenType.LBRACE, "Expected '{' to start the loop body")
      const body = []
      while (!this.check(TokenType.RBRACE)) {
        body.push(this.parseStatement())
      }
      this.expect(TokenType.RBRACE, "Expected '}' to close the loop body")
      return ForRangeStatement(varName, start, end, body)
    }

    throw new Error(
      `Expected 'in' or 'from' after 'for ${varName}' at line ${this.peek().line}`,
    )
  }

  parseRepeatStatement() {
    const count = this.parseExpression()
    this.expect(TokenType.LBRACE, "Expected '{' to start the repeat body")
    const body = []
    while (!this.check(TokenType.RBRACE)) {
      body.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close the repeat body")
    return RepeatStatement(count, body)
  }

  parseTryStatement() {
    this.expect(TokenType.LBRACE, "Expected '{' to start try block")
    const tryBlock = []
    while (!this.check(TokenType.RBRACE)) {
      tryBlock.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close try block")

    let catchParam = null
    let catchBlock = null
    if (this.match(TokenType.CATCH)) {
      if (this.match(TokenType.LPAREN)) {
        catchParam = this.expect(
          TokenType.IDENTIFIER,
          'Expected catch parameter name',
        ).value
        this.expect(TokenType.RPAREN, "Expected ')' after catch parameter")
      }
      this.expect(TokenType.LBRACE, "Expected '{' to start catch block")
      catchBlock = []
      while (!this.check(TokenType.RBRACE)) {
        catchBlock.push(this.parseStatement())
      }
      this.expect(TokenType.RBRACE, "Expected '}' to close catch block")
    }

    let finallyBlock = null
    if (this.match(TokenType.FINALLY)) {
      this.expect(TokenType.LBRACE, "Expected '{' to start finally block")
      finallyBlock = []
      while (!this.check(TokenType.RBRACE)) {
        finallyBlock.push(this.parseStatement())
      }
      this.expect(TokenType.RBRACE, "Expected '}' to close finally block")
    }

    return TryStatement(tryBlock, catchParam, catchBlock, finallyBlock)
  }

  parseExpression() {
    return this.parseAssignment()
  }

  parseAssignment() {
    const arrow = this.tryParseArrowFunction()
    if (arrow) return arrow

    const left = this.parseTernary()

    if (this.match(TokenType.EQUALS)) {
      const value = this.parseAssignment()
      return AssignmentExpr(left, value)
    }

    if (this.match(TokenType.NULLISH_EQUALS)) {
      const value = this.parseAssignment()
      return AssignmentExpr(left, NullishCoalescingExpr(left, value))
    }

    const compoundOp = COMPOUND_ASSIGNMENT_OPS[this.peek().type]

    if (compoundOp) {
      this.advance()
      const value = this.parseAssignment()
      return AssignmentExpr(left, BinaryExpr(compoundOp, left, value))
    }

    return left
  }

  // Arrow functions are tried with backtracking before falling
  // through to the normal ternary/assignment chain, since both forms
  // (`x => ...` and `(a, b) => ...`) start with tokens that are
  // otherwise perfectly valid as a bare identifier or a grouped
  // expression. v1 scope is expression-body only (no `{ ... }` block
  // body), matching a single call to parseAssignment for the body --
  // deliberately narrower than full JS arrow functions, to avoid
  // reopening the entire statement grammar inside an expression
  // position.
  tryParseArrowFunction() {
    // single-param form: x => expr  or  x: Type => expr
    if (
      this.check(TokenType.IDENTIFIER) ||
      KEYWORD_TOKEN_TYPES.has(this.peek().type)
    ) {
      const next = this.tokens[this.pos + 1]
      if (next && next.type === TokenType.ARROW) {
        const param = this.advance().value
        this.advance() // consume '=>'
        const body = this.parseAssignment()
        return ArrowFunctionExpr([param], body, [null])
      }
      if (next && next.type === TokenType.COLON) {
        const savedPos = this.pos
        const param = this.advance().value
        this.advance() // consume ':'
        const paramType = this.parseTypeExpression()
        if (this.check(TokenType.ARROW)) {
          this.advance()
          const body = this.parseAssignment()
          return ArrowFunctionExpr([param], body, [paramType])
        }
        // wasn't actually a typed arrow param -- back out
        this.pos = savedPos
      }
      return null
    }

    // (a, b) => expr  or  (a: Type, b: Type) => expr
    if (this.check(TokenType.LPAREN)) {
      const savedPos = this.pos
      this.pos++

      const params = []
      const paramTypes = []
      let isValidParamList = true

      if (!this.check(TokenType.RPAREN)) {
        while (true) {
          if (
            !this.check(TokenType.IDENTIFIER) &&
            !KEYWORD_TOKEN_TYPES.has(this.peek().type)
          ) {
            isValidParamList = false
            break
          }
          params.push(this.advance().value)
          paramTypes.push(
            this.match(TokenType.COLON) ? this.parseTypeExpression() : null,
          )
          if (this.match(TokenType.COMMA)) continue
          break
        }
      }

      if (isValidParamList && this.check(TokenType.RPAREN)) {
        this.pos++
        if (this.check(TokenType.ARROW)) {
          this.pos++
          const body = this.parseAssignment()
          return ArrowFunctionExpr(params, body, paramTypes)
        }
      }

      this.pos = savedPos
      return null
    }
    return null
  }

  parseTernary() {
    const condition = this.parseNullishCoalescing()
    if (this.match(TokenType.QUESTION)) {
      const consequent = this.parseAssignment()
      this.expect(TokenType.COLON, "Expected ':' in ternary expression")
      const alternate = this.parseAssignment()
      return TernaryExpr(condition, consequent, alternate)
    }
    return condition
  }

  parseNullishCoalescing() {
    let left = this.parseLogicalOr()
    while (this.match(TokenType.NULLISH)) {
      const right = this.parseLogicalOr()
      left = NullishCoalescingExpr(left, right)
    }
    return left
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd()
    while (this.match(TokenType.OR)) {
      const right = this.parseLogicalAnd()
      left = BinaryExpr('||', left, right)
    }
    return left
  }

  parseLogicalAnd() {
    let left = this.parseEquality()
    while (this.match(TokenType.AND)) {
      const right = this.parseEquality()
      left = BinaryExpr('&&', left, right)
    }
    return left
  }

  parseEquality() {
    let left = this.parseComparison()
    while (this.check(TokenType.IS)) {
      this.advance()
      const negated = this.match(TokenType.NOT)
      const right = this.parseComparison()
      left = BinaryExpr(negated ? '!==' : '===', left, right)
    }
    return left
  }

  parseComparison() {
    let left = this.parsePredicate()
    while (COMPARISON_SYMBOLS[this.peek().type]) {
      const operator = COMPARISON_SYMBOLS[this.advance().type]
      const right = this.parsePredicate()
      left = BinaryExpr(operator, left, right)
    }
    return left
  }

  parsePredicate() {
    const left = this.parseAdditive()

    if (this.match(TokenType.EXISTS)) {
      return BinaryExpr('!=', left, Literal(null))
    }
    if (this.match(TokenType.MISSING)) {
      return BinaryExpr('==', left, Literal(null))
    }
    if (this.match(TokenType.HAS)) {
      const right = this.parseAdditive()
      return CallExpr(MemberExpr(left, 'includes'), [right])
    }

    return left
  }

  parseAdditive() {
    let left = this.parseMultiplicative()
    while (ADDITIVE_SYMBOLS[this.peek().type]) {
      const operator = ADDITIVE_SYMBOLS[this.advance().type]
      const right = this.parseMultiplicative()
      left = BinaryExpr(operator, left, right)
    }
    return left
  }

  parseMultiplicative() {
    let left = this.parseUnary()
    while (MULTIPLICATIVE_SYMBOLS[this.peek().type]) {
      const operator = MULTIPLICATIVE_SYMBOLS[this.advance().type]
      const right = this.parseUnary()
      left = BinaryExpr(operator, left, right)
    }
    return left
  }

  parseUnary() {
    if (this.match(TokenType.AWAIT)) {
      return AwaitExpr(this.parseUnary())
    }
    if (this.match(TokenType.NOT)) {
      return UnaryExpr('!', this.parseUnary())
    }
    if (this.match(TokenType.MINUS)) {
      return UnaryExpr('-', this.parseUnary())
    }
    return this.parseMemberExpression()
  }

  parseMemberExpression() {
    let expr = this.parsePrimary()
    while (true) {
      if (this.match(TokenType.DOT)) {
        const property = this.parsePropertyName("after '.'")
        expr = MemberExpr(expr, property)
        continue
      }
      if (this.match(TokenType.LBRACKET)) {
        const property = this.parseExpression()
        this.expect(
          TokenType.RBRACKET,
          "Expected ']' to close computed member access",
        )
        expr = MemberExpr(expr, property, true)
        continue
      }
      if (this.check(TokenType.LPAREN)) {
        expr = CallExpr(expr, this.parseCallArguments())
        continue
      }

      if (this.match(TokenType.QUESTION_DOT)) {
        if (this.match(TokenType.LBRACKET)) {
          const property = this.parseExpression()
          this.expect(
            TokenType.RBRACKET,
            "Expected ']' to close optional computed member access",
          )
          expr = MemberExpr(expr, property, true, true)
          continue
        }
        const property = this.parsePropertyName("after '?.'")
        expr = MemberExpr(expr, property, false, true)
        continue
      }

      break
    }
    return expr
  }

  parseCallArguments() {
    this.expect(TokenType.LPAREN, "Expected '(' to start call arguments")
    const args = []
    while (!this.check(TokenType.RPAREN)) {
      if (this.match(TokenType.SPREAD)) {
        args.push(SpreadElement(this.parseExpression()))
      } else {
        args.push(this.parseExpression())
      }
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RPAREN, "Expected ')' to close call arguments")
    return args
  }

  parsePrimary() {
    if (this.match(TokenType.NEW)) {
      let callee = this.parsePrimary()
      while (this.match(TokenType.DOT)) {
        const property = this.expect(
          TokenType.IDENTIFIER,
          "Expected a property name after '.'",
        ).value
        callee = MemberExpr(callee, property)
      }
      let args = []
      if (this.check(TokenType.LPAREN)) {
        args = this.parseCallArguments()
      }
      return NewExpr(callee, args)
    }

    if (this.check(TokenType.NUMBER) || this.check(TokenType.STRING)) {
      return Literal(this.advance().value)
    }

    if (this.check(TokenType.TEMPLATE_LITERAL)) {
      const rawParts = this.advance().value
      const parts = rawParts.map((p) =>
        p.type === 'text'
          ? p
          : { type: 'expr', expression: parseExpressionString(p.source) },
      )
      return TemplateLiteralExpr(parts)
    }

    if (
      this.check(TokenType.IDENTIFIER) ||
      KEYWORD_TOKEN_TYPES.has(this.peek().type)
    ) {
      const name = this.advance().value
      // "null"/"true"/"false"/"undefined" are lexed as plain identifier
      // tokens (there's no separate keyword TokenType for them), but
      // they're JS keyword literals, not variable/state references.
      // Emitting them as Literal here -- instead of Identifier -- means
      // every downstream consumer (generateExpression,
      // generateTemplateExpression, and anything added later) treats
      // them correctly by construction, rather than each one needing its
      // own special-case list of magic strings to avoid prefixing them
      // with "instance.".
      if (name === 'null') return Literal(null)
      if (name === 'undefined') return Literal(undefined)
      if (name === 'true') return Literal(true)
      if (name === 'false') return Literal(false)
      return Identifier(name)
    }

    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression()
      this.expect(
        TokenType.RPAREN,
        "Expected ')' to close a grouped expression",
      )
      return expr
    }
    if (this.match(TokenType.LBRACE)) {
      return this.parseObjectLiteral()
    }
    if (this.match(TokenType.LBRACKET)) {
      return this.parseArrayLiteral()
    }
    throw new Error(
      `Unexpected token ${this.peek().type} at line ${this.peek().line}`,
    )
  }

  // Type expressions are captured as plain strings, not a full type
  // AST -- Tylix's own codegen never interprets the, it only needs the exact TS source text to paste into the
  // virtual .ts file handed to the TypeScript compiler API.
  parseTypeExpression() {
    let left = this.parseUnionTypeOperand()
    while (this.check(TokenType.PIPE)) {
      this.advance()
      const right = this.parseUnionTypeOperand()
      left = `${left} | ${right}`
    }
    return left
  }

  parseUnionTypeOperand() {
    let type = this.parsePrimaryType()
    while (this.check(TokenType.LBRACKET)) {
      this.advance()
      this.expect(TokenType.RBRACKET, "Expected ']' to close array type")
      type = `${type}[]`
    }
    return type
  }

  parsePrimaryType() {
    if (this.check(TokenType.LBRACE)) {
      return this.parseObjectTypeLiteral()
    }
    if (this.match(TokenType.LPAREN)) {
      const inner = this.parseTypeExpression()
      this.expect(TokenType.RPAREN, "Expected ')' to close grouped type")
      return `(${inner})`
    }

    let name = this.expect(TokenType.IDENTIFIER, 'Expected a type name').value
    while (this.match(TokenType.DOT)) {
      const prop = this.expect(
        TokenType.IDENTIFIER,
        "Expected a property name after '.'",
      ).value
      name += `.${prop}`
    }

    if (this.match(TokenType.LT)) {
      const args = [this.parseTypeExpression()]
      while (this.match(TokenType.COMMA)) {
        args.push(this.parseTypeExpression())
      }
      this.expect(TokenType.GT, "Expected '>' to close generic type arguments")
      name += `<${args.join(', ')}>`
    }

    return name
  }

  parseObjectTypeLiteral() {
    this.expect(TokenType.LBRACE, "Expected '{' to start object type")
    const members = []
    while (!this.check(TokenType.RBRACE)) {
      const key = this.expect(
        TokenType.IDENTIFIER,
        'Expected a property name',
      ).value
      const optional = this.match(TokenType.QUESTION)
      this.expect(
        TokenType.COLON,
        "Expected ':' after property name in object type",
      )
      const valueType = this.parseTypeExpression()
      members.push(`${key}${optional ? '?' : ''}: ${valueType}`)
      if (!this.match(TokenType.COMMA)) this.match(TokenType.SEMICOLON)
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close object type")
    return `{ ${members.join('; ')} }`
  }

  parseArrayLiteral() {
    const elements = []
    while (!this.check(TokenType.RBRACKET)) {
      if (this.match(TokenType.SPREAD)) {
        elements.push(SpreadElement(this.parseExpression()))
      } else {
        elements.push(this.parseExpression())
      }
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RBRACKET, "Expected ']' to close array literal")
    return ArrayExpr(elements)
  }

  parseObjectLiteral() {
    const properties = []
    while (!this.check(TokenType.RBRACE)) {
      const isString = this.check(TokenType.STRING)
      const isKeywordKey =
        !isString && KEYWORD_TOKEN_TYPES.has(this.peek().type)
      const key = isString
        ? this.advance().value
        : isKeywordKey
          ? this.advance().value
          : this.expect(TokenType.IDENTIFIER, 'Expected an object key').value

      if (!isString && !this.check(TokenType.COLON)) {
        // Shorthand: { name } means { name: name }
        properties.push({ key, value: Identifier(key) })
        this.match(TokenType.COMMA)
        continue
      }

      this.expect(TokenType.COLON, "Expected ':' after object key")
      const value = this.parseExpression()
      properties.push({ key, value })
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close object literal")
    return ObjectExpr(properties)
  }

  peek() {
    return this.tokens[this.pos]
  }

  advance() {
    return this.tokens[this.pos++]
  }

  check(type) {
    return this.peek().type === type
  }

  match(type) {
    if (this.check(type)) {
      this.pos++
      return true
    }
    return false
  }

  expect(type, message) {
    if (this.check(type)) return this.advance()
    throw new Error(
      `${message} at line ${this.peek().line}, got ${this.peek().type}`,
    )
  }
}
