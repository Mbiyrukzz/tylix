import { TokenType } from '../lexer/tokenTypes.js'
import {
  PageNode,
  PropNode,
  StateNode,
  MethodNode,
  AssignmentExpr,
  BinaryExpr,
  UnaryExpr,
  TernaryExpr,
  ArrowFunctionExpr,
  TemplateLiteralExpr,
  Identifier,
  MemberExpr,
  Literal,
  ReturnStatement,
  ExpressionStatement,
  CallExpr,
  AwaitExpr,
  VariableDeclaration,
  ObjectExpr,
  ArrayExpr,
  IfStatement,
  ForInStatement,
  ForRangeStatement,
  RepeatStatement,
  BreakStatement,
  ContinueStatement,
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
      onMount: null,
    }

    while (!this.check(TokenType.EOF)) {
      if (this.match(TokenType.PROPS)) {
        page.props = this.parseSectionBlock(this.parsePropEntry.bind(this))
      } else if (this.match(TokenType.STATE)) {
        page.state = this.parseSectionBlock(this.parseStateEntry.bind(this))
      } else if (this.match(TokenType.COMPUTED)) {
        page.computed = this.parseSectionBlock(this.parseMethod.bind(this))
      } else if (this.match(TokenType.ACTION)) {
        page.actions = this.parseSectionBlock(this.parseMethod.bind(this))
      } else if (this.match(TokenType.ONMOUNT)) {
        page.onMount = this.parseOnMountBody()
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
    while (!this.isSectionKeyword(this.peek().type)) {
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
      type === TokenType.STATE ||
      type === TokenType.COMPUTED ||
      type === TokenType.ACTION ||
      type === TokenType.ONMOUNT ||
      type === TokenType.EOF
    )
  }

  parseBareBlock(parseEntry) {
    const entries = []
    while (!this.isSectionKeyword(this.peek().type)) {
      entries.push(parseEntry())
      this.match(TokenType.COMMA)
    }
    return entries
  }

  parsePropEntry() {
    const name = this.expect(TokenType.IDENTIFIER, 'Expected prop name').value
    this.expect(TokenType.COLON, "Expected ':' after prop name")
    const propType = this.expect(
      TokenType.IDENTIFIER,
      'Expected prop type',
    ).value
    return PropNode(name, propType)
  }

  parseStateEntry() {
    const name = this.expect(TokenType.IDENTIFIER, 'Expected state name').value
    this.expect(TokenType.COLON, "Expected ':' after state name")
    if (this.match(TokenType.MINUS)) {
      const num = this.expect(
        TokenType.NUMBER,
        "Expected a number after '-'",
      ).value
      return StateNode(name, Literal(-num))
    }
    const value = this.parsePrimary()
    return StateNode(name, value)
  }

  parseMethod() {
    const isAsync = this.match(TokenType.ASYNC)
    const name = this.expect(TokenType.IDENTIFIER, 'Expected method name').value
    this.expect(TokenType.LPAREN, "Expected '(' after method name")
    const params = []
    while (!this.check(TokenType.RPAREN)) {
      params.push(
        this.expect(TokenType.IDENTIFIER, 'Expected parameter name').value,
      )
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RPAREN, "Expected ')' after parameters")
    this.expect(TokenType.LBRACE, "Expected '{' to start method body")

    const body = []
    while (!this.check(TokenType.RBRACE)) {
      body.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close method body")

    return { ...MethodNode(name, params, body), isAsync }
  }

  parseStatement() {
    if (this.match(TokenType.RETURN)) {
      const argument = this.parseExpression()
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
      const name = this.expect(
        TokenType.IDENTIFIER,
        'Expected variable name',
      ).value
      this.expect(TokenType.EQUALS, "Expected '=' in variable declaration")
      const init = this.parseExpression()
      this.match(TokenType.SEMICOLON)
      return VariableDeclaration(kind, name, init)
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
    if (this.check(TokenType.IDENTIFIER)) {
      const next = this.tokens[this.pos + 1]
      if (next && next.type === TokenType.ARROW) {
        const param = this.advance().value
        this.advance() // consume '=>'
        const body = this.parseAssignment()
        return ArrowFunctionExpr([param], body)
      }
      return null
    }

    if (this.check(TokenType.LPAREN)) {
      const savedPos = this.pos
      this.pos++ // consume '('

      const params = []
      let isValidParamList = true

      if (!this.check(TokenType.RPAREN)) {
        while (true) {
          if (!this.check(TokenType.IDENTIFIER)) {
            isValidParamList = false
            break
          }
          params.push(this.advance().value)
          if (this.match(TokenType.COMMA)) continue
          break
        }
      }

      if (isValidParamList && this.check(TokenType.RPAREN)) {
        this.pos++ // consume ')'
        if (this.check(TokenType.ARROW)) {
          this.pos++ // consume '=>'
          const body = this.parseAssignment()
          return ArrowFunctionExpr(params, body)
        }
      }

      // Not actually an arrow function (either the parameter list
      // wasn't a plain comma-separated identifier list, or there was
      // no '=>' after the closing paren) -- back out completely so
      // the normal parsePrimary grouped-expression path handles it.
      this.pos = savedPos
      return null
    }

    return null
  }

  parseTernary() {
    const condition = this.parseLogicalOr()
    if (this.match(TokenType.QUESTION)) {
      const consequent = this.parseAssignment()
      this.expect(TokenType.COLON, "Expected ':' in ternary expression")
      const alternate = this.parseAssignment()
      return TernaryExpr(condition, consequent, alternate)
    }
    return condition
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
        const property = this.expect(
          TokenType.IDENTIFIER,
          "Expected a property name after '.'",
        ).value
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
      break
    }
    return expr
  }

  parseCallArguments() {
    this.expect(TokenType.LPAREN, "Expected '(' to start call arguments")
    const args = []
    while (!this.check(TokenType.RPAREN)) {
      args.push(this.parseExpression())
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RPAREN, "Expected ')' to close call arguments")
    return args
  }

  parsePrimary() {
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

    if (this.check(TokenType.IDENTIFIER)) {
      return Identifier(this.advance().value)
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

  parseArrayLiteral() {
    const elements = []
    while (!this.check(TokenType.RBRACKET)) {
      elements.push(this.parseExpression())
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RBRACKET, "Expected ']' to close array literal")
    return ArrayExpr(elements)
  }

  parseObjectLiteral() {
    const properties = []
    while (!this.check(TokenType.RBRACE)) {
      const key = this.check(TokenType.STRING)
        ? this.advance().value
        : this.expect(TokenType.IDENTIFIER, 'Expected an object key').value
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
