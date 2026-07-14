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
    const page = { props: [], state: [], computed: [], actions: [] };

    while (!this.check(TokenType.EOF)) {
      if (this.match(TokenType.PROPS)) {
        page.props = this.parseBlock(this.parsePropEntry.bind(this));
      } else if (this.match(TokenType.STATE)) {
        page.state = this.parseBlock(this.parseStateEntry.bind(this));
      } else if (this.match(TokenType.COMPUTED)) {
        page.computed = this.parseBlock(this.parseMethod.bind(this));
      } else if (this.match(TokenType.ACTION)) {
        page.actions = this.parseBlock(this.parseMethod.bind(this));
      } else {
        throw new Error(
          `Unexpected token ${this.peek().type} at line ${this.peek().line}`
        );
      }
    }

    return PageNode(page);
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

    return MethodNode(name, params, body);
  }

  parseStatement() {
    if (this.match(TokenType.RETURN)) {
      const argument = this.parseExpression();
      this.match(TokenType.SEMICOLON);
      return ReturnStatement(argument);
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
    let left = this.parseMemberExpression();
    while (BINARY_OPS.has(this.peek().type)) {
      const operator = OP_SYMBOLS[this.advance().type];
      const right = this.parseMemberExpression();
      left = BinaryExpr(operator, left, right);
    }
    return left;
  }

  parseMemberExpression() {
    let expr = this.parsePrimary();
    while (this.match(TokenType.DOT)) {
      const property = this.expect(
        TokenType.IDENTIFIER,
        "Expected property name after '.'"
      ).value;
      expr = MemberExpr(expr, property);
    }
    return expr;
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
    throw new Error(
      `Unexpected token ${this.peek().type} at line ${this.peek().line}`
    );
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
