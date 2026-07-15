import { TokenType } from "../lexer/tokenTypes.js";
import {
  PageNode,
  PropNode,
  StateNode,
  MethodNode,
  AssignmentExpr,
  BinaryExpr,
  Identifier,
  MemberExpr,
  Literal,
  ReturnStatement,
  ExpressionStatement,
  CallExpr,
  AwaitExpr,
  VariableDeclaration,
  ObjectExpr,
} from "../ast/nodes.js";

const BINARY_OPS = new Set([
  TokenType.PLUS,
  TokenType.MINUS,
  TokenType.STAR,
  TokenType.SLASH,
  TokenType.GT,
  TokenType.LT,
]);

const OP_SYMBOLS = {
  [TokenType.PLUS]: "+",
  [TokenType.MINUS]: "-",
  [TokenType.STAR]: "*",
  [TokenType.SLASH]: "/",
  [TokenType.GT]: ">",
  [TokenType.LT]: "<",
};

/**
 * Parses the token stream from the Lexer into a Page AST.
 * v1 scope: props / state / computed / action blocks. Method bodies
 * support return statements plus assignment/binary expressions over
 * identifiers, member access (a.b), numbers, and strings.
 * No operator precedence yet: binary chains parse strictly left to
 * right (a - b + c behaves normally, but a + b * c does NOT give
 * multiplication priority — that's an Analyzer/Parser v2 concern).
 */
export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse() {
    const page = { props: [], state: [], computed: [], actions: [], onMount: null };

    while (!this.check(TokenType.EOF)) {
      if (this.match(TokenType.PROPS)) {
        page.props = this.parseSectionBlock(this.parsePropEntry.bind(this));
      } else if (this.match(TokenType.STATE)) {
        page.state = this.parseSectionBlock(this.parseStateEntry.bind(this));
      } else if (this.match(TokenType.COMPUTED)) {
        page.computed = this.parseSectionBlock(this.parseMethod.bind(this));
      } else if (this.match(TokenType.ACTION)) {
        page.actions = this.parseSectionBlock(this.parseMethod.bind(this));
      } else if (this.match(TokenType.ONMOUNT)) {
        page.onMount = this.parseOnMountBody();
      } else {
        throw new Error(
          `Unexpected token ${this.peek().type} at line ${this.peek().line}`
        );
      }
    }

    return PageNode(page);
  }

  // onMount has no name/params -- it's just a body, either braced
  // ("onMount { ... }") or bare ("onMount\n  ...") like other sections.
  parseOnMountBody() {
    const isAsync = this.match(TokenType.ASYNC);
    if (this.check(TokenType.LBRACE)) {
      this.expect(TokenType.LBRACE, "Expected '{' to start onMount body");
      const body = [];
      while (!this.check(TokenType.RBRACE)) {
        body.push(this.parseStatement());
      }
      this.expect(TokenType.RBRACE, "Expected '}' to close onMount body");
      return { body, isAsync };
    }
    const body = [];
    while (!this.isSectionKeyword(this.peek().type)) {
      body.push(this.parseStatement());
    }
    return { body, isAsync };
  }

  // A section's entries can be written two ways:
  //   1. Brace-wrapped (original syntax): state { count: 0 }
  //   2. Bare (Tylix's native .tyx syntax): state, then count: 0 on its own line
  // Bare sections run until the next top-level section keyword or EOF,
  // since there's no closing delimiter to look for.
  parseSectionBlock(parseEntry) {
    if (this.check(TokenType.LBRACE)) {
      return this.parseBlock(parseEntry);
    }
    return this.parseBareBlock(parseEntry);
  }

  // Consumes `{ entry entry ... }`, entries optionally comma-separated.
  parseBlock(parseEntry) {
    this.expect(TokenType.LBRACE, "Expected '{' to start block");
    const entries = [];
    while (!this.check(TokenType.RBRACE)) {
      entries.push(parseEntry());
      this.match(TokenType.COMMA);
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close block");
    return entries;
  }

  isSectionKeyword(type) {
    return (
      type === TokenType.PROPS ||
      type === TokenType.STATE ||
      type === TokenType.COMPUTED ||
      type === TokenType.ACTION ||
      type === TokenType.ONMOUNT ||
      type === TokenType.EOF
    );
  }

  // Consumes entries with no wrapping delimiter at all, stopping as
  // soon as the next top-level section keyword (or EOF) is reached.
  parseBareBlock(parseEntry) {
    const entries = [];
    while (!this.isSectionKeyword(this.peek().type)) {
      entries.push(parseEntry());
    }
    return entries;
  }

  parsePropEntry() {
    const name = this.expect(TokenType.IDENTIFIER, "Expected prop name").value;
    this.expect(TokenType.COLON, "Expected ':' after prop name");
    const propType = this.expect(TokenType.IDENTIFIER, "Expected prop type").value;
    return PropNode(name, propType);
  }

  parseStateEntry() {
    const name = this.expect(TokenType.IDENTIFIER, "Expected state name").value;
    this.expect(TokenType.COLON, "Expected ':' after state name");
    const value = this.parseLiteral();
    return StateNode(name, value);
  }

  parseLiteral() {
    if (this.check(TokenType.NUMBER) || this.check(TokenType.STRING)) {
      return Literal(this.advance().value);
    }
    throw new Error(
      `Expected a literal value at line ${this.peek().line}, got ${this.peek().type}`
    );
  }

  parseMethod() {
    const isAsync = this.match(TokenType.ASYNC);
    const name = this.expect(TokenType.IDENTIFIER, "Expected method name").value;
    this.expect(TokenType.LPAREN, "Expected '(' after method name");
    const params = [];
    while (!this.check(TokenType.RPAREN)) {
      params.push(this.expect(TokenType.IDENTIFIER, "Expected parameter name").value);
      this.match(TokenType.COMMA);
    }
    this.expect(TokenType.RPAREN, "Expected ')' after parameters");
    this.expect(TokenType.LBRACE, "Expected '{' to start method body");

    const body = [];
    while (!this.check(TokenType.RBRACE)) {
      body.push(this.parseStatement());
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close method body");

    return { ...MethodNode(name, params, body), isAsync };
  }

  parseStatement() {
    if (this.match(TokenType.RETURN)) {
      const argument = this.parseExpression();
      this.match(TokenType.SEMICOLON);
      return ReturnStatement(argument);
    }
    if (this.check(TokenType.CONST) || this.check(TokenType.LET)) {
      const kind = this.advance().type === TokenType.CONST ? "const" : "let";
      const name = this.expect(TokenType.IDENTIFIER, "Expected variable name").value;
      this.expect(TokenType.EQUALS, "Expected '=' in variable declaration");
      const init = this.parseExpression();
      this.match(TokenType.SEMICOLON);
      return VariableDeclaration(kind, name, init);
    }
    const expression = this.parseExpression();
    this.match(TokenType.SEMICOLON);
    return ExpressionStatement(expression);
  }

  parseExpression() {
    const left = this.parseBinaryChain();
    if (this.match(TokenType.EQUALS)) {
      const value = this.parseExpression();
      return AssignmentExpr(left, value);
    }
    return left;
  }

  parseBinaryChain() {
    let left = this.parseUnary();
    while (BINARY_OPS.has(this.peek().type)) {
      const operator = OP_SYMBOLS[this.advance().type];
      const right = this.parseUnary();
      left = BinaryExpr(operator, left, right);
    }
    return left;
  }

  parseUnary() {
    if (this.match(TokenType.AWAIT)) {
      return AwaitExpr(this.parseUnary());
    }
    return this.parseMemberExpression();
  }

  parseMemberExpression() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.match(TokenType.DOT)) {
        const property = this.expect(
          TokenType.IDENTIFIER,
          "Expected property name after '.'"
        ).value;
        expr = MemberExpr(expr, property);
        continue;
      }
      if (this.check(TokenType.LPAREN)) {
        expr = CallExpr(expr, this.parseCallArguments());
        continue;
      }
      break;
    }
    return expr;
  }

  // Consumes `(arg, arg, ...)` -- the LPAREN itself is checked but not
  // consumed by the caller, so this expects and consumes it here.
  parseCallArguments() {
    this.expect(TokenType.LPAREN, "Expected '(' to start call arguments");
    const args = [];
    while (!this.check(TokenType.RPAREN)) {
      args.push(this.parseExpression());
      this.match(TokenType.COMMA);
    }
    this.expect(TokenType.RPAREN, "Expected ')' to close call arguments");
    return args;
  }

  parsePrimary() {
    if (this.check(TokenType.NUMBER) || this.check(TokenType.STRING)) {
      return Literal(this.advance().value);
    }
    if (this.check(TokenType.IDENTIFIER)) {
      return Identifier(this.advance().value);
    }
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN, "Expected ')' to close grouped expression");
      return expr;
    }
    if (this.match(TokenType.LBRACE)) {
      return this.parseObjectLiteral();
    }
    throw new Error(
      `Unexpected token ${this.peek().type} at line ${this.peek().line}`
    );
  }

  // Consumes `{ key: value, key: value }` -- LBRACE already consumed
  // by the caller before this is invoked.
  parseObjectLiteral() {
    const properties = [];
    while (!this.check(TokenType.RBRACE)) {
      const key = this.check(TokenType.STRING)
        ? this.advance().value
        : this.expect(TokenType.IDENTIFIER, "Expected object key").value;
      this.expect(TokenType.COLON, "Expected ':' after object key");
      const value = this.parseExpression();
      properties.push({ key, value });
      this.match(TokenType.COMMA);
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close object literal");
    return ObjectExpr(properties);
  }

  // --- token stream helpers ---

  peek() {
    return this.tokens[this.pos];
  }

  advance() {
    return this.tokens[this.pos++];
  }

  check(type) {
    return this.peek().type === type;
  }

  match(type) {
    if (this.check(type)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(type, message) {
    if (this.check(type)) return this.advance();
    throw new Error(`${message} at line ${this.peek().line}, got ${this.peek().type}`);
  }
}
