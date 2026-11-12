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
  FunctionExpr,
  FunctionDeclaration,
  TemplateLiteralExpr,
  TaggedTemplateExpr,
  SpreadElement,
  SequenceExpr,
  YieldExpr,
  Identifier,
  MemberExpr,
  Literal,
  ReturnStatement,
  ExpressionStatement,
  EmptyStatement,
  CallExpr,
  NewExpr,
  AwaitExpr,
  AsExpr,
  NonNullExpr,
  VariableDeclaration,
  ObjectExpr,
  ArrayExpr,
  ObjectPattern,
  ArrayPattern,
  TryStatement,
  IfStatement,
  ForInStatement,
  ForKeysStatement,
  ForStatement,
  ForRangeStatement,
  RepeatStatement,
  BreakStatement,
  ContinueStatement,
  LabeledStatement,
  DebuggerStatement,
  ClassDeclaration,
  ClassExpr,
  CapabilityRefNode,
  MetaEntryNode,
  BlockStatement,
  ThrowStatement,
  WhileStatement,
  DoWhileStatement,
  SwitchStatement,
} from '../ast/nodes.js'
import { parseExpressionString } from './parseExpressionString.js'

const COMPARISON_SYMBOLS = {
  [TokenType.GT]: '>',
  [TokenType.LT]: '<',
  [TokenType.GTE]: '>=',
  [TokenType.LTE]: '<=',
  [TokenType.INSTANCEOF]: 'instanceof',
  [TokenType.IN]: 'in',
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
// node types. (`||=` / `&&=` / `??=` and the shift forms are handled
// separately in parseAssignment.)
const COMPOUND_ASSIGNMENT_OPS = {
  [TokenType.PLUS_EQUALS]: '+',
  [TokenType.MINUS_EQUALS]: '-',
  [TokenType.STAR_EQUALS]: '*',
  [TokenType.SLASH_EQUALS]: '/',
  [TokenType.PERCENT_EQUALS]: '%',
  [TokenType.STAR_STAR_EQUALS]: '**',
  [TokenType.AMP_EQUALS]: '&',
  [TokenType.PIPE_EQUALS]: '|',
  [TokenType.CARET_EQUALS]: '^',
}

// Renders a destructuring pattern back to source text. Arrow and
// function params are stored as plain strings, so `([k, v]) => ...`
// and `({ id, name }) => ...` are kept as "[k, v]" / "{ id, name }"
// and emitted verbatim by the codegen.
function bindingToSource(t) {
  if (typeof t === 'string') return t
  if (t.type === 'ObjectPattern') {
    const parts = t.properties.map((p) => {
      if (p.defaultValue) {
        throw new Error(
          'Default values inside destructured parameters are not supported; use a default on the whole parameter or a const inside the body',
        )
      }
      return typeof p.binding === 'string' && p.binding === p.key
        ? p.key
        : `${p.key}: ${bindingToSource(p.binding)}`
    })
    if (t.rest) parts.push(`...${t.rest}`)
    return `{ ${parts.join(', ')} }`
  }
  const parts = t.elements.map((el) => {
    if (el === null) return ''
    if (el.defaultValue) {
      throw new Error(
        'Default values inside destructured parameters are not supported; use a default on the whole parameter or a const inside the body',
      )
    }
    return bindingToSource(el.binding)
  })
  if (t.rest) parts.push(`...${t.rest}`)
  return `[${parts.join(', ')}]`
}

// True when token `b` starts exactly where token `a` ends -- i.e. the
// two were written with no whitespace between them.
function adjacent(a, b) {
  return !!a && !!b && b.start === a.start + String(a.value).length
}

// True when evaluating `node` would run an assignment, ++/--, await
// or yield. Compound assignment (`a[i++] += 1`) and ++/-- duplicate
// their target in the desugared AST, so such a target would be
// evaluated twice. Nested function bodies don't run when the target
// is evaluated, so they are skipped.
function containsMutation(node) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(containsMutation)
  if (node instanceof RegExp) return false
  if (
    node.type === 'AssignmentExpression' ||
    node.type === 'AwaitExpression' ||
    node.type === 'YieldExpression'
  ) {
    return true
  }
  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression'
  ) {
    return false
  }
  return Object.values(node).some(
    (v) => v && typeof v === 'object' && containsMutation(v),
  )
}

// `a has b` works for arrays and strings (includes) AND Sets/Maps
// (has). Built from ordinary nodes, so every generator (script,
// template, virtual .ts) handles it with no new node type:
//   ((__c, __v) => typeof __c.has === "function"
//       ? __c.has(__v) : __c.includes(__v))(a, b)
function hasExpr(collection, value) {
  const c = Identifier('__c')
  const v = Identifier('__v')
  const test = BinaryExpr(
    '===',
    UnaryExpr('typeof', MemberExpr(c, 'has')),
    Literal('function'),
  )
  const body = TernaryExpr(
    test,
    CallExpr(MemberExpr(c, 'has'), [v]),
    CallExpr(MemberExpr(c, 'includes'), [v]),
  )
  const fn = ArrowFunctionExpr(
    ['__c', '__v'],
    body,
    [null, null],
    false,
    [null, null],
  )
  return CallExpr(fn, [collection, value])
}

/**
 * Parses the token stream from the Lexer into a Page AST.
 *
 * Expressions are parsed with real precedence-climbing, low to high:
 *   arrow function (x => expr, (a, b = 1) => expr, destructured and
 *     rest params, optional params, return types, block bodies
 *     x => { ... }, and the async forms of all of these) -- tried
 *     first, with backtracking
 *   yield / yield*  (inside generators)
 *   assignment  (= += -= *= /= %= **= ??= ||= &&= &= |= ^= <<= >>= >>>=)
 *   ternary     (?:)
 *   nullish     (??)
 *   logical or  (or, ||)
 *   logical and (and, &&)
 *   bitwise or  (|)
 *   bitwise xor (^)
 *   bitwise and (&)
 *   equality    (is / is not, also ===, !==, ==, !=)
 *   comparison  (> < >= <= instanceof in, and the `as` / `satisfies` casts)
 *   predicate   (has / exists / missing)
 *   shift       (<< >> >>>)
 *   additive    (+ -)
 *   multiplicative (* / %)
 *   exponent    (**, right-associative)
 *   unary       (not, !, ~, -, +, await, typeof, delete, void, prefix ++/--)
 *   postfix     (x++, x--)
 *   member/call (a.b, a(), a?.b, a?.(), tag`text`, and the non-null `x!`)
 *   primary     (literals, regex, bigint, identifiers, grouping and the
 *                comma operator, arrays, objects, template literals,
 *                function and class expressions, new.target)
 *
 * `x++` / `++x` desugar to `x = x + 1` (same trick as compound
 * assignment), so the expression's value is the NEW value in both
 * forms, unlike JS where postfix yields the old one.
 *
 * Shifts are recombined from adjacent LT/GT tokens (see
 * shiftOperatorAt) because the Lexer never emits << or >> as single
 * tokens -- that keeps `Array<Array<T>>` parseable as a type.
 *
 * Contextual words (`static`, `get`, `set`, `as`, `satisfies`,
 * `yield`, `class`, `extends`, `debugger`) are ordinary identifier
 * tokens; the parser recognises them by position.
 */
export class Parser {
  constructor(tokens, options = {}) {
    this.tokens = tokens
    this.pos = 0
    this.options = options
    this.looseNot = options.not === 'loose'
    // True while parsing the body of a generator, where `yield` is an
    // operator instead of an ordinary name.
    this.inGenerator = false
  }

  withGenerator(flag, fn) {
    const previous = this.inGenerator
    this.inGenerator = flag
    try {
      return fn()
    } finally {
      this.inGenerator = previous
    }
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

  // These double as ordinary field names in practice (title
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
    const name = this.parseNameToken('Expected prop name')
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

    // A full assignment-level expression, so initializers like
    // `new Date().toLocaleDateString()`, `Date.now()`, `60 * 60`,
    // `ready ? 1 : 2`, `[...]` / `{...}` and arrow functions
    // (`onSave: () => 1`) all parse. Entries always start with a name,
    // so no operator can be the start of the next entry.
    let value = this.parseAssignment()

    // Keep `-5` as a plain negative Literal, as before.
    if (
      value.type === 'UnaryExpression' &&
      value.operator === '-' &&
      value.argument.type === 'Literal' &&
      typeof value.argument.value === 'number'
    ) {
      value = Literal(-value.argument.value)
    }

    return { ...StateNode(name, value, typeAnnotation), line: startLine }
  }

  // Parses a parameter list. The opening '(' must already be
  // consumed; this consumes the closing ')'. Supports types
  // (`a: number`), optional (`a?: number`), defaults (`a = 1`), rest
  // (`...args`) and destructured params (`{ id, name }`, `[a, b]`).
  parseParamList() {
    const params = []
    while (!this.check(TokenType.RPAREN)) {
      const rest = this.match(TokenType.SPREAD)
      let name
      if (this.check(TokenType.LBRACE) || this.check(TokenType.LBRACKET)) {
        name = bindingToSource(this.parseBindingTarget())
      } else {
        name = this.parseNameToken('Expected parameter name')
      }
      const optional = this.match(TokenType.QUESTION)
      let typeAnnotation = null
      if (this.match(TokenType.COLON)) {
        typeAnnotation = this.parseTypeExpression()
      }
      let defaultValue = null
      if (this.match(TokenType.EQUALS)) {
        defaultValue = this.parseAssignment()
      }
      params.push({ name, typeAnnotation, defaultValue, rest, optional })
      this.match(TokenType.COMMA)
    }
    this.expect(TokenType.RPAREN, "Expected ')' after parameters")
    return params
  }

  parseMethod() {
    const startLine = this.peek().line
    const isAsync = this.match(TokenType.ASYNC)
    const name = this.parseNameToken('Expected method name')
    this.expect(TokenType.LPAREN, "Expected '(' after method name")

    const params = this.parseParamList()

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
  // property values, array pattern elements and catch clauses, so
  // `const { a: { b } } = x` and `const [[a, b]] = x` both fall out
  // for free instead of needing separate parsing logic in each place.
  parseBindingTarget() {
    if (this.check(TokenType.LBRACE)) return this.parseObjectPattern()
    if (this.check(TokenType.LBRACKET)) return this.parseArrayPattern()
    return this.parseNameToken('Expected a binding name')
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
      const key = this.parseNameToken('Expected a property name')
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

  // `{ stmt stmt ... }` -- shared by the newer statement forms
  // (while, switch clauses, block-bodied arrows, functions, loops).
  // `what` only feeds the error messages.
  parseBlockStatements(what) {
    this.expect(TokenType.LBRACE, `Expected '{' to start ${what}`)
    const body = []
    while (!this.check(TokenType.RBRACE)) {
      body.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, `Expected '}' to close ${what}`)
    return body
  }

  // After `function` (and an optional preceding `async`, already
  // consumed by the caller): `[*] [name] (params) [: ReturnType] { body }`.
  parseFunctionRest(isAsync) {
    this.expect(TokenType.FUNCTION, "Expected 'function'")
    const isGenerator = this.match(TokenType.STAR)
    let name = null
    if (!this.check(TokenType.LPAREN)) {
      name = this.parseNameToken('Expected a function name')
    }
    this.expect(TokenType.LPAREN, "Expected '(' after function name")
    const params = this.parseParamList()
    if (this.match(TokenType.COLON)) {
      this.parseTypeExpression() // return type: checked only in the virtual .ts
    }
    const body = this.withGenerator(isGenerator, () =>
      this.parseBlockStatements('function body'),
    )
    return { name, params, body, isAsync, isGenerator }
  }

  isFunctionKeywordAhead() {
    return (
      this.check(TokenType.FUNCTION) ||
      (this.check(TokenType.ASYNC) &&
        this.tokens[this.pos + 1]?.type === TokenType.FUNCTION)
    )
  }

  // `name:` at the start of a statement is a label (`outer: for ...`).
  isLabelAhead() {
    return (
      this.check(TokenType.IDENTIFIER) &&
      this.tokens[this.pos + 1]?.type === TokenType.COLON
    )
  }

  // The optional label of `break outer` / `continue outer`: an
  // identifier on the SAME line as the keyword.
  optionalLabel(keywordToken) {
    const next = this.peek()
    if (next.type === TokenType.IDENTIFIER && next.line === keywordToken.line) {
      this.advance()
      return next.value
    }
    return null
  }

  // Constructs that exist in JavaScript but not in .tyx scripts. Most
  // of them lex as plain identifiers, so without this check they
  // would parse as a bare name and fail later with a confusing
  // generated-JS error.
  rejectUnsupportedKeyword() {
    const tok = this.peek()
    const next = this.tokens[this.pos + 1]
    if (!next) return

    if (
      tok.type === TokenType.AWAIT &&
      next.type === TokenType.IDENTIFIER &&
      next.value === 'using' &&
      next.line === tok.line &&
      this.tokens[this.pos + 2]?.type === TokenType.IDENTIFIER
    ) {
      throw new Error(
        `'await using' (resource management) is not supported; use try / finally (line ${tok.line})`,
      )
    }

    if (tok.type !== TokenType.IDENTIFIER) return

    if (
      tok.value === 'var' &&
      (next.type === TokenType.IDENTIFIER ||
        next.type === TokenType.LBRACE ||
        next.type === TokenType.LBRACKET)
    ) {
      throw new Error(
        `'var' is not supported; use 'const' or 'let' (line ${tok.line})`,
      )
    }

    if (
      tok.value === 'using' &&
      next.type === TokenType.IDENTIFIER &&
      next.line === tok.line
    ) {
      throw new Error(
        `'using' (resource management) is not supported; use try / finally (line ${tok.line})`,
      )
    }

    if (tok.value === 'import' && next.type !== TokenType.LPAREN) {
      throw new Error(
        `'import' statements and import.meta are not supported inside scripts; put Tylix imports above the template, or use dynamic import("...") (line ${tok.line})`,
      )
    }

    if (
      tok.value === 'export' &&
      (next.type === TokenType.CONST ||
        next.type === TokenType.LET ||
        next.type === TokenType.FUNCTION ||
        next.type === TokenType.ASYNC ||
        next.type === TokenType.DEFAULT ||
        next.type === TokenType.LBRACE ||
        next.type === TokenType.STAR ||
        (next.type === TokenType.IDENTIFIER && next.value === 'class'))
    ) {
      throw new Error(
        `'export' is not supported inside scripts; a .tyx file is its own module (line ${tok.line})`,
      )
    }

    if (tok.value === 'with' && next.type === TokenType.LPAREN) {
      let depth = 0
      let i = this.pos + 1
      for (; i < this.tokens.length; i++) {
        const t = this.tokens[i]
        if (t.type === TokenType.LPAREN) depth++
        else if (t.type === TokenType.RPAREN) {
          depth--
          if (depth === 0) break
        }
      }
      if (this.tokens[i + 1]?.type === TokenType.LBRACE) {
        throw new Error(`'with' statements are not supported (line ${tok.line})`)
      }
    }
  }

  parseStatementInner() {
    if (this.match(TokenType.SEMICOLON)) {
      return EmptyStatement()
    }

    // A `{` at the start of a statement is always a block (JS rule).
    if (this.check(TokenType.LBRACE)) {
      return BlockStatement(this.parseBlockStatements('block'))
    }

    if (this.isLabelAhead()) {
      const label = this.advance().value
      this.advance() // ':'
      return LabeledStatement(label, this.parseStatement())
    }

    if (this.match(TokenType.RETURN)) {
      const hasValue =
        !this.check(TokenType.SEMICOLON) && !this.check(TokenType.RBRACE)
      const argument = hasValue ? this.parseExpression() : null
      this.match(TokenType.SEMICOLON)
      return ReturnStatement(argument)
    }

    if (this.match(TokenType.THROW)) {
      const argument = this.parseExpression()
      this.match(TokenType.SEMICOLON)
      return ThrowStatement(argument)
    }

    if (this.match(TokenType.IF)) {
      return this.parseIfStatement()
    }

    if (this.match(TokenType.WHILE)) {
      return this.parseWhileStatement()
    }

    if (this.match(TokenType.DO)) {
      return this.parseDoWhileStatement()
    }

    if (this.match(TokenType.SWITCH)) {
      return this.parseSwitchStatement()
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

    if (this.check(TokenType.BREAK)) {
      const tok = this.advance()
      const label = this.optionalLabel(tok)
      this.match(TokenType.SEMICOLON)
      return BreakStatement(label)
    }

    if (this.check(TokenType.CONTINUE)) {
      const tok = this.advance()
      const label = this.optionalLabel(tok)
      this.match(TokenType.SEMICOLON)
      return ContinueStatement(label)
    }

    // `class Name { ... }` as a declaration.
    if (this.isClassAhead(false)) {
      return this.parseClass(false)
    }

    // `function name(...) { }` / `async function* name(...) { }` as a
    // declaration. An anonymous `function (...) { }` falls through to
    // the expression-statement path below.
    if (this.isFunctionKeywordAhead()) {
      let idx = this.pos + (this.check(TokenType.ASYNC) ? 2 : 1)
      if (this.tokens[idx]?.type === TokenType.STAR) idx++
      const nameTok = this.tokens[idx]
      const afterName = this.tokens[idx + 1]
      if (
        nameTok &&
        nameTok.type !== TokenType.LPAREN &&
        afterName &&
        afterName.type === TokenType.LPAREN
      ) {
        const isAsync = this.match(TokenType.ASYNC)
        const fn = this.parseFunctionRest(isAsync)
        return FunctionDeclaration(
          fn.name,
          fn.params,
          fn.body,
          fn.isAsync,
          fn.isGenerator,
        )
      }
    }

    if (this.check(TokenType.CONST) || this.check(TokenType.LET)) {
      const kind = this.advance().type === TokenType.CONST ? 'const' : 'let'
      const decl = this.parseDeclarators(kind)
      this.match(TokenType.SEMICOLON)
      return decl
    }

    this.rejectUnsupportedKeyword()

    const tok = this.peek()
    const after = this.tokens[this.pos + 1]
    if (
      tok.type === TokenType.IDENTIFIER &&
      tok.value === 'debugger' &&
      !(
        after &&
        (after.type === TokenType.DOT ||
          after.type === TokenType.LPAREN ||
          after.type === TokenType.EQUALS)
      )
    ) {
      this.advance()
      this.match(TokenType.SEMICOLON)
      return DebuggerStatement()
    }

    const expression = this.parseExpression()
    this.match(TokenType.SEMICOLON)
    return ExpressionStatement(expression)
  }

  // `: Type` after a binding name, or null when there is none.
  parseOptionalTypeAnnotation() {
    return this.match(TokenType.COLON) ? this.parseTypeExpression() : null
  }

  // `target [: Type] [= init] [, target [: Type] [= init] ...]` after
  // const/let. `let x` (no initializer) is allowed; `const x` requires one.
  parseDeclarators(kind) {
    const target = this.parseBindingTarget()
    const typeAnnotation = this.parseOptionalTypeAnnotation()
    let init = null
    if (this.match(TokenType.EQUALS)) {
      init = this.parseExpression()
    } else if (kind === 'const') {
      throw new Error(
        `Missing initializer in const declaration at line ${this.peek().line}`,
      )
    }
    const more = []
    while (this.match(TokenType.COMMA)) {
      const name = this.parseBindingTarget()
      const moreType = this.parseOptionalTypeAnnotation()
      let moreInit = null
      if (this.match(TokenType.EQUALS)) {
        moreInit = this.parseExpression()
      } else if (kind === 'const') {
        throw new Error(
          `Missing initializer in const declaration at line ${this.peek().line}`,
        )
      }
      more.push({ name, init: moreInit, typeAnnotation: moreType })
    }
    return VariableDeclaration(kind, target, init, more, typeAnnotation)
  }

  parseIfStatement() {
    const condition = this.parseExpression()
    this.expect(TokenType.LBRACE, "Expected '{' to start if body")
    const consequent = []
    while (!this.check(TokenType.RBRACE)) {
      consequent.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close if body")

    let alternate = null
    if (this.match(TokenType.ELSE)) {
      if (this.check(TokenType.IF)) {
        const startLine = this.peek().line
        this.advance()
        const nested = this.parseIfStatement()
        nested.line = nested.line ?? startLine
        alternate = [nested]
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

  // `while cond { ... }` or `while (cond) { ... }`. Parentheses need no
  // special handling: `(cond)` already parses as a grouped expression,
  // which also keeps `while (a) and (b) { ... }` working.
  parseWhileStatement() {
    const condition = this.parseExpression()
    const body = this.parseBlockStatements('while body')
    return WhileStatement(condition, body)
  }

  // `do { ... } while cond` (parentheses optional, trailing ; optional)
  parseDoWhileStatement() {
    const body = this.parseBlockStatements('do body')
    this.expect(TokenType.WHILE, "Expected 'while' after the do body")
    const condition = this.parseExpression()
    this.match(TokenType.SEMICOLON)
    return DoWhileStatement(body, condition)
  }

  // Tylix-style switch: braces for every clause, no fallthrough, and
  // `case a, b { ... }` instead of stacked labels. Codegen emits the
  // `break` itself.
  //
  //   switch status {
  //     case "paid", "settled" { ... }
  //     default { ... }
  //   }
  parseSwitchStatement() {
    const discriminant = this.parseExpression()
    this.expect(TokenType.LBRACE, "Expected '{' to start switch body")

    const cases = []
    let hasDefault = false
    while (!this.check(TokenType.RBRACE)) {
      if (this.match(TokenType.CASE)) {
        const tests = [this.parseExpression()]
        while (this.match(TokenType.COMMA)) {
          tests.push(this.parseExpression())
        }
        this.rejectSwitchColon()
        cases.push({ tests, body: this.parseBlockStatements('case body') })
      } else if (this.check(TokenType.DEFAULT)) {
        const line = this.advance().line
        if (hasDefault) {
          throw new Error(`Duplicate 'default' in switch at line ${line}`)
        }
        hasDefault = true
        this.rejectSwitchColon()
        cases.push({
          tests: null,
          body: this.parseBlockStatements('default body'),
        })
      } else {
        throw new Error(
          `Expected 'case' or 'default' in switch at line ${this.peek().line}, got ${this.peek().type}`,
        )
      }
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close switch body")

    return SwitchStatement(discriminant, cases)
  }

  rejectSwitchColon() {
    if (this.check(TokenType.COLON)) {
      throw new Error(
        `Switch cases use braces, not a colon: case a, b { ... } (no fallthrough), at line ${this.peek().line}`,
      )
    }
  }

  // All the `for` forms:
  //   for x in arr { }                 for x of arr { }
  //   for [k, v] of Object.entries(o)  for const x of arr { }
  //   for i from 0 to n { }
  //   for (const x of arr) { }         for (const k in obj) { }   (keys)
  //   for (let i = 0, n = a.length; i < n; i++) { }
  //   for await (const x of stream) { }   for await x of stream { }
  parseForStatement() {
    const isAwait = this.match(TokenType.AWAIT)

    if (this.check(TokenType.LPAREN)) {
      return this.parseParenFor(isAwait)
    }

    let declKind = 'const'
    if (this.check(TokenType.CONST) || this.check(TokenType.LET)) {
      declKind = this.advance().type === TokenType.CONST ? 'const' : 'let'
    }

    let varName
    if (this.check(TokenType.LBRACKET) || this.check(TokenType.LBRACE)) {
      varName = this.parseBindingTarget()
    } else {
      varName = this.expect(
        TokenType.IDENTIFIER,
        "Expected a loop variable name after 'for'",
      ).value
    }

    if (this.match(TokenType.IN) || this.match(TokenType.OF)) {
      const iterable = this.parseExpression()
      const body = this.parseBlockStatements('loop body')
      return ForInStatement(varName, iterable, body, declKind, isAwait)
    }

    if (this.match(TokenType.FROM)) {
      if (isAwait) {
        throw new Error(
          `'for await' needs 'in' or 'of', not 'from ... to' (line ${this.peek().line})`,
        )
      }
      if (typeof varName !== 'string') {
        throw new Error(
          `'for ... from ... to' needs a plain loop variable at line ${this.peek().line}`,
        )
      }
      const start = this.parseExpression()
      this.expect(TokenType.TO, "Expected 'to' after the loop's starting value")
      const end = this.parseExpression()
      const body = this.parseBlockStatements('loop body')
      return ForRangeStatement(varName, start, end, body)
    }

    throw new Error(
      `Expected 'in', 'of' or 'from' after 'for ${typeof varName === 'string' ? varName : '...'}' at line ${this.peek().line}`,
    )
  }

  parseParenFor(isAwait = false) {
    this.expect(TokenType.LPAREN, "Expected '(' after 'for'")

    let init = null
    if (this.check(TokenType.SEMICOLON)) {
      // no init
    } else if (this.check(TokenType.CONST) || this.check(TokenType.LET)) {
      const kind = this.advance().type === TokenType.CONST ? 'const' : 'let'
      const target = this.parseBindingTarget()

      if (this.check(TokenType.OF) || this.check(TokenType.IN)) {
        const isOf = this.advance().type === TokenType.OF
        if (isAwait && !isOf) {
          throw new Error(
            `'for await' needs 'of', not 'in' (line ${this.peek().line})`,
          )
        }
        const iterable = this.parseExpression()
        this.expect(TokenType.RPAREN, "Expected ')' after the for header")
        const body = this.parseBlockStatements('loop body')
        return isOf
          ? ForInStatement(target, iterable, body, kind, isAwait)
          : ForKeysStatement(target, iterable, body, kind)
      }

      // C-style declaration: re-enter declarator parsing with the
      // target we already consumed.
      const typeAnnotation = this.parseOptionalTypeAnnotation()
      let first = null
      if (this.match(TokenType.EQUALS)) {
        first = this.parseExpression()
      } else if (kind === 'const') {
        throw new Error(
          `Missing initializer in const declaration at line ${this.peek().line}`,
        )
      }
      const more = []
      while (this.match(TokenType.COMMA)) {
        const name = this.parseBindingTarget()
        const moreType = this.parseOptionalTypeAnnotation()
        let moreInit = null
        if (this.match(TokenType.EQUALS)) moreInit = this.parseExpression()
        more.push({ name, init: moreInit, typeAnnotation: moreType })
      }
      init = VariableDeclaration(kind, target, first, more, typeAnnotation)
    } else {
      const expressions = [this.parseExpression()]
      while (this.match(TokenType.COMMA)) {
        expressions.push(this.parseExpression())
      }
      init = { type: 'ExpressionList', expressions }
    }

    if (isAwait) {
      throw new Error(
        `'for await' needs the form for await (const x of iterable) (line ${this.peek().line})`,
      )
    }

    this.expect(TokenType.SEMICOLON, "Expected ';' after the for-loop init")
    const test = this.check(TokenType.SEMICOLON) ? null : this.parseExpression()
    this.expect(TokenType.SEMICOLON, "Expected ';' after the for-loop condition")

    const update = []
    if (!this.check(TokenType.RPAREN)) {
      update.push(this.parseExpression())
      while (this.match(TokenType.COMMA)) {
        update.push(this.parseExpression())
      }
    }
    this.expect(TokenType.RPAREN, "Expected ')' to close the for header")

    const body = this.parseBlockStatements('loop body')
    return ForStatement(init, test, update, body)
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

  // `catch (e)`, `catch (e: unknown)`, `catch ({ message })`,
  // `catch ([first])` and the optional-binding `catch { }`.
  parseTryStatement() {
    this.expect(TokenType.LBRACE, "Expected '{' to start try block")
    const tryBlock = []
    while (!this.check(TokenType.RBRACE)) {
      tryBlock.push(this.parseStatement())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close try block")

    let catchParam = null
    let catchType = null
    let catchBlock = null
    if (this.match(TokenType.CATCH)) {
      if (this.match(TokenType.LPAREN)) {
        catchParam = this.parseBindingTarget()
        if (this.match(TokenType.COLON)) {
          catchType = this.parseTypeExpression()
        }
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

    return TryStatement(tryBlock, catchParam, catchBlock, finallyBlock, catchType)
  }

  // ---- classes ----

  // `class Name {` / `class Name extends X {` as a declaration, or
  // (isExpression) also the anonymous `class {` / `class extends X {`.
  isClassAhead(isExpression) {
    const tok = this.peek()
    const next = this.tokens[this.pos + 1]
    if (tok.type !== TokenType.IDENTIFIER || tok.value !== 'class' || !next) {
      return false
    }
    if (isExpression) {
      return next.type === TokenType.LBRACE || next.type === TokenType.IDENTIFIER
    }
    return next.type === TokenType.IDENTIFIER && next.value !== 'extends'
  }

  parseClass(isExpression) {
    this.advance() // 'class'
    let name = null
    if (this.check(TokenType.IDENTIFIER) && this.peek().value !== 'extends') {
      name = this.advance().value
    }
    let superClass = null
    if (this.check(TokenType.IDENTIFIER) && this.peek().value === 'extends') {
      this.advance()
      superClass = this.parseMemberExpression()
    }
    this.expect(TokenType.LBRACE, "Expected '{' to start the class body")
    const members = []
    while (!this.check(TokenType.RBRACE)) {
      if (this.match(TokenType.SEMICOLON)) continue
      members.push(this.parseClassMember())
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close the class body")
    return isExpression
      ? ClassExpr(name, superClass, members)
      : ClassDeclaration(name, superClass, members)
  }

  isMemberKeyStart(tok) {
    return (
      !!tok &&
      (tok.type === TokenType.IDENTIFIER ||
        KEYWORD_TOKEN_TYPES.has(tok.type) ||
        tok.type === TokenType.STRING ||
        tok.type === TokenType.NUMBER ||
        tok.type === TokenType.LBRACKET ||
        tok.type === TokenType.STAR)
    )
  }

  // True when the current token is the contextual modifier `word`
  // (static / async / get / set) rather than a member NAME: a name
  // would be followed by `(`, `=`, `;` or `}`, a modifier by the key.
  modifierAhead(word) {
    const tok = this.peek()
    const next = this.tokens[this.pos + 1]
    return (
      (tok.type === TokenType.IDENTIFIER ||
        KEYWORD_TOKEN_TYPES.has(tok.type)) &&
      tok.value === word &&
      this.isMemberKeyStart(next) &&
      next.line === tok.line
    )
  }

  parseClassMember() {
    const line = this.peek().line

    // static { ... }
    if (
      this.peek().type === TokenType.IDENTIFIER &&
      this.peek().value === 'static' &&
      this.tokens[this.pos + 1]?.type === TokenType.LBRACE
    ) {
      this.advance()
      const body = this.parseBlockStatements('static block')
      return { kind: 'staticBlock', static: true, body, line }
    }

    let isStatic = false
    let isAsync = false
    let isGenerator = false
    let kind = 'method'

    if (this.modifierAhead('static')) {
      this.advance()
      isStatic = true
    }
    if (this.modifierAhead('async')) {
      this.advance()
      isAsync = true
    }
    if (this.match(TokenType.STAR)) {
      isGenerator = true
    } else if (!isAsync && (this.modifierAhead('get') || this.modifierAhead('set'))) {
      kind = this.advance().value
    }

    let key = null
    let keyExpr = null
    let keyKind = 'name'
    if (this.match(TokenType.LBRACKET)) {
      keyExpr = this.parseExpression()
      this.expect(
        TokenType.RBRACKET,
        "Expected ']' to close a computed class member name",
      )
      keyKind = 'computed'
    } else if (this.check(TokenType.STRING)) {
      key = this.advance().value
      keyKind = 'string'
    } else if (this.check(TokenType.NUMBER)) {
      key = String(this.advance().value)
      keyKind = 'number'
    } else {
      key = this.parseNameToken('Expected a class member name')
    }

    // Method, accessor or constructor
    if (this.check(TokenType.LPAREN)) {
      this.advance()
      const params = this.parseParamList()
      let returnType = null
      if (this.match(TokenType.COLON)) {
        returnType = this.parseTypeExpression()
      }
      const body = this.withGenerator(isGenerator, () =>
        this.parseBlockStatements('method body'),
      )
      const isConstructor =
        !isStatic && keyKind === 'name' && key === 'constructor' && kind === 'method'
      return {
        kind: isConstructor ? 'constructor' : kind,
        static: isStatic,
        key,
        keyExpr,
        keyKind,
        isAsync,
        isGenerator,
        params,
        body,
        returnType,
        line,
      }
    }

    // Field
    if (kind !== 'method' || isAsync || isGenerator) {
      throw new Error(
        `Expected '(' after the class member name at line ${this.peek().line}`,
      )
    }
    if (!this.match(TokenType.QUESTION)) {
      // definite-assignment `x!: T` is accepted and ignored
      if (this.check(TokenType.NOT) && this.peek().value === '!') this.advance()
    }
    const typeAnnotation = this.parseOptionalTypeAnnotation()
    let value = null
    if (this.match(TokenType.EQUALS)) {
      value = this.parseAssignment()
    }
    this.match(TokenType.SEMICOLON)
    return {
      kind: 'field',
      static: isStatic,
      key,
      keyExpr,
      keyKind,
      typeAnnotation,
      value,
      line,
    }
  }

  // ---- expressions ----

  parseExpression() {
    return this.parseAssignment()
  }

  // `<<=` is LT + LTE, `>>=` is GT + GTE, `>>>=` is GT + GT + GTE, all
  // written with no whitespace between them. Returns { op, len } (len =
  // number of tokens) or null.
  compoundShiftAt() {
    const a = this.tokens[this.pos]
    const b = this.tokens[this.pos + 1]
    const c = this.tokens[this.pos + 2]
    if (!a || !b) return null
    if (a.type === TokenType.LT && b.type === TokenType.LTE && adjacent(a, b)) {
      return { op: '<<', len: 2 }
    }
    if (a.type === TokenType.GT && b.type === TokenType.GTE && adjacent(a, b)) {
      return { op: '>>', len: 2 }
    }
    if (
      a.type === TokenType.GT &&
      b.type === TokenType.GT &&
      c &&
      c.type === TokenType.GTE &&
      adjacent(a, b) &&
      adjacent(b, c)
    ) {
      return { op: '>>>', len: 3 }
    }
    return null
  }

  // `<<` is LT LT, `>>` is GT GT, `>>>` is GT GT GT, adjacent. Refuses
  // anything that is really a compound assignment (`>>>=` also starts
  // with GT GT).
  shiftOperatorAt() {
    const a = this.tokens[this.pos]
    const b = this.tokens[this.pos + 1]
    const c = this.tokens[this.pos + 2]
    if (!a || !b) return null
    if (a.type === TokenType.LT && b.type === TokenType.LT && adjacent(a, b)) {
      return { op: '<<', len: 2 }
    }
    if (a.type === TokenType.GT && b.type === TokenType.GT && adjacent(a, b)) {
      if (c && c.type === TokenType.GTE && adjacent(b, c)) return null // >>>=
      if (c && c.type === TokenType.GT && adjacent(b, c)) {
        return { op: '>>>', len: 3 }
      }
      return { op: '>>', len: 2 }
    }
    return null
  }

  // Compound assignment and ++/-- repeat their target in the desugared
  // AST, so a target that mutates or awaits (`a[i++] += 1`) would run
  // twice. Refuse it instead of silently doing the wrong thing.
  assertTargetRunsOnce(target) {
    if (containsMutation(target)) {
      throw new Error(
        `This assignment target contains ++, --, = or await, which would run twice; split it into two statements (line ${this.peek().line})`,
      )
    }
  }

  // `yield` is only an operator inside a generator body.
  isYieldAhead() {
    const tok = this.peek()
    return tok.type === TokenType.IDENTIFIER && tok.value === 'yield'
  }

  parseYield() {
    const tok = this.advance() // 'yield'
    const delegate = this.match(TokenType.STAR)
    const next = this.peek()
    const endsHere =
      next.line !== tok.line ||
      next.type === TokenType.RPAREN ||
      next.type === TokenType.RBRACKET ||
      next.type === TokenType.RBRACE ||
      next.type === TokenType.COMMA ||
      next.type === TokenType.SEMICOLON ||
      next.type === TokenType.COLON ||
      next.type === TokenType.EOF
    const argument = delegate || !endsHere ? this.parseAssignment() : null
    return YieldExpr(argument, delegate)
  }

  parseAssignment() {
    if (this.inGenerator && this.isYieldAhead()) {
      return this.parseYield()
    }

    const arrow = this.tryParseArrowFunction()
    if (arrow) return arrow

    const left = this.parseTernary()

    if (this.match(TokenType.EQUALS)) {
      const value = this.parseAssignment()
      return AssignmentExpr(left, value)
    }

    if (this.match(TokenType.NULLISH_EQUALS)) {
      this.assertTargetRunsOnce(left)
      const value = this.parseAssignment()
      return AssignmentExpr(left, NullishCoalescingExpr(left, value))
    }

    if (this.match(TokenType.OR_EQUALS)) {
      this.assertTargetRunsOnce(left)
      const value = this.parseAssignment()
      return AssignmentExpr(left, BinaryExpr('||', left, value))
    }

    if (this.match(TokenType.AND_EQUALS)) {
      this.assertTargetRunsOnce(left)
      const value = this.parseAssignment()
      return AssignmentExpr(left, BinaryExpr('&&', left, value))
    }

    const compoundOp = COMPOUND_ASSIGNMENT_OPS[this.peek().type]

    if (compoundOp) {
      this.assertTargetRunsOnce(left)
      this.advance()
      const value = this.parseAssignment()
      return AssignmentExpr(left, BinaryExpr(compoundOp, left, value))
    }

    const shiftAssign = this.compoundShiftAt()
    if (shiftAssign) {
      this.assertTargetRunsOnce(left)
      this.pos += shiftAssign.len
      const value = this.parseAssignment()
      return AssignmentExpr(left, BinaryExpr(shiftAssign.op, left, value))
    }

    return left
  }

  // Parses a type expression speculatively: on failure the position is
  // restored and null is returned instead of throwing. Needed because
  // `cond ? label : 'none'` looks exactly like the start of a typed
  // arrow parameter (`label: Type => ...`) until the type fails to parse.
  tryParseTypeExpression() {
    const savedPos = this.pos
    try {
      return this.parseTypeExpression()
    } catch {
      this.pos = savedPos
      return null
    }
  }

  // Speculatively parses a destructuring pattern used as an arrow
  // parameter and returns its source text ("[k, v]", "{ id, name }"),
  // or null (position restored) if it isn't a valid param pattern.
  tryParseDestructuredParam() {
    const savedPos = this.pos
    try {
      return bindingToSource(this.parseBindingTarget())
    } catch {
      this.pos = savedPos
      return null
    }
  }

  // After `=>`: either a block body or a single expression.
  //
  // A `{` after `=>` is a BLOCK (JS semantics), except when the
  // tokens right after it make that impossible -- `{ ...x }`,
  // `{ key: value }`, `{ a, b }` -- in which case it's an object
  // literal, so the older `x => { id: x }` style keeps working. A
  // block can't legally start with `name :` (no labels) or `name ,`
  // (no comma operator), so the lookahead is unambiguous. The cases it
  // can't resolve are `{}`, `{ name }`, `{ [key]: v }` and
  // `{ method() {} }`; those are blocks, exactly as in JS. Wrap an
  // object literal in parentheses: `x => ({ ... })`.
  //
  // `yield` is never an operator inside an arrow body.
  parseArrowBody() {
    return this.withGenerator(false, () => {
      if (this.check(TokenType.LBRACE) && !this.looksLikeObjectLiteral()) {
        return BlockStatement(this.parseBlockStatements('arrow function body'))
      }
      return this.parseAssignment()
    })
  }

  looksLikeObjectLiteral() {
    const first = this.tokens[this.pos + 1]
    const second = this.tokens[this.pos + 2]
    if (!first) return false
    if (first.type === TokenType.SPREAD) return true
    const isKey =
      first.type === TokenType.STRING ||
      first.type === TokenType.NUMBER ||
      first.type === TokenType.IDENTIFIER ||
      KEYWORD_TOKEN_TYPES.has(first.type)
    return (
      isKey &&
      !!second &&
      (second.type === TokenType.COLON || second.type === TokenType.COMMA)
    )
  }

  // Entry point for arrow functions, including the async forms:
  //   async x => ...        async (a, b) => ...
  //   async x: Type => ...  async (a: Type) => ...
  //
  // `async` is a keyword token but also a legal identifier name, so
  // it is only treated as the async modifier when what follows could
  // start an arrow's parameter list (an identifier/keyword name or
  // '('). `async => 1` (a param literally named async) still goes
  // down the normal path, and so does `async(x)` as a plain call,
  // because the speculative parse below backs out and restores the
  // position when no `=>` follows.
  tryParseArrowFunction() {
    if (this.check(TokenType.ASYNC)) {
      const next = this.tokens[this.pos + 1]
      const startsParams =
        next &&
        (next.type === TokenType.LPAREN ||
          next.type === TokenType.IDENTIFIER ||
          (next.type !== TokenType.ARROW && KEYWORD_TOKEN_TYPES.has(next.type)))
      if (startsParams) {
        const savedPos = this.pos
        this.advance() // consume 'async'
        const arrow = this.tryParseSyncArrow()
        if (arrow) return { ...arrow, isAsync: true }
        this.pos = savedPos
        return null
      }
    }
    return this.tryParseSyncArrow()
  }

  // Arrow functions are tried with backtracking before falling
  // through to the normal ternary/assignment chain, since both forms
  // (`x => ...` and `(a, b) => ...`) start with tokens that are
  // otherwise perfectly valid as a bare identifier or a grouped
  // expression. The body is an expression or, via parseArrowBody, a
  // `{ ... }` statement block (script code only -- templates reject
  // BlockStatement in their expression generators).
  //
  // Parenthesized params may be plain names, destructuring patterns
  // ([k, v], { id, name }), rest params (...args), typed (a: number),
  // optional (a?: number) and have defaults (a = 1). A return type may
  // follow the closing paren: `(a: number): number => a * 2`.
  tryParseSyncArrow() {
    // single-param form: x => expr  or  x: Type => expr
    if (
      this.check(TokenType.IDENTIFIER) ||
      KEYWORD_TOKEN_TYPES.has(this.peek().type)
    ) {
      const next = this.tokens[this.pos + 1]
      if (next && next.type === TokenType.ARROW) {
        const param = this.advance().value
        this.advance() // consume '=>'
        const body = this.parseArrowBody()
        return ArrowFunctionExpr([param], body, [null], false, [null])
      }
      if (next && next.type === TokenType.COLON) {
        const savedPos = this.pos
        const param = this.advance().value
        this.advance() // consume ':'
        const paramType = this.tryParseTypeExpression()
        if (paramType !== null && this.check(TokenType.ARROW)) {
          this.advance()
          const body = this.parseArrowBody()
          return ArrowFunctionExpr([param], body, [paramType], false, [null])
        }
        // wasn't actually a typed arrow param (e.g. the `x : y` part
        // of a ternary) -- back out
        this.pos = savedPos
      }
      return null
    }

    // (a, b) => expr  or  (a: Type, b?: T, c = 1, ...rest) => expr
    // also ([k, v]) => expr, ({ id }) => expr
    if (this.check(TokenType.LPAREN)) {
      const savedPos = this.pos
      this.pos++

      const params = []
      const paramTypes = []
      const paramDefaults = []
      const paramOptional = []
      let isValidParamList = true

      if (!this.check(TokenType.RPAREN)) {
        while (true) {
          let name
          if (this.match(TokenType.SPREAD)) {
            if (!this.check(TokenType.IDENTIFIER)) {
              isValidParamList = false
              break
            }
            name = `...${this.advance().value}`
          } else if (
            this.check(TokenType.LBRACKET) ||
            this.check(TokenType.LBRACE)
          ) {
            name = this.tryParseDestructuredParam()
            if (name === null) {
              isValidParamList = false
              break
            }
          } else if (
            this.check(TokenType.IDENTIFIER) ||
            KEYWORD_TOKEN_TYPES.has(this.peek().type)
          ) {
            name = this.advance().value
          } else {
            isValidParamList = false
            break
          }
          params.push(name)

          // `(a ? b : c)` also reaches here, but then `b` is neither
          // `:`, `,` nor `)`, so the list is rejected below and the
          // whole attempt backs out to a grouped expression.
          paramOptional.push(this.match(TokenType.QUESTION))

          let paramType = null
          if (this.match(TokenType.COLON)) {
            paramType = this.tryParseTypeExpression()
            if (paramType === null) {
              isValidParamList = false
              break
            }
          }
          paramTypes.push(paramType)

          let defaultValue = null
          if (this.match(TokenType.EQUALS)) {
            try {
              defaultValue = this.parseAssignment()
            } catch {
              isValidParamList = false
              break
            }
          }
          paramDefaults.push(defaultValue)

          if (this.match(TokenType.COMMA)) continue
          break
        }
      }

      if (isValidParamList && this.check(TokenType.RPAREN)) {
        this.pos++

        // Optional return type: `(x): number => ...`. In a ternary
        // (`c ? (x) : y`) the type parses but no `=>` follows, so the
        // whole attempt backs out.
        let returnType = null
        if (this.check(TokenType.COLON)) {
          this.pos++
          returnType = this.tryParseTypeExpression()
          if (returnType === null || !this.check(TokenType.ARROW)) {
            this.pos = savedPos
            return null
          }
        }

        if (this.check(TokenType.ARROW)) {
          this.pos++
          const body = this.parseArrowBody()
          return ArrowFunctionExpr(
            params,
            body,
            paramTypes,
            false,
            paramDefaults,
            paramOptional,
            returnType,
          )
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
    let left = this.parseNotOperand()
    while (this.match(TokenType.AND)) {
      const right = this.parseNotOperand()
      left = BinaryExpr('&&', left, right)
    }
    return left
  }

  // Loose mode only: the WORD `not` (value 'not') sits above is/has/
  // exists. In tight mode, or for the symbol `!`, this falls straight
  // through and parseUnary handles it as before.
  parseNotOperand() {
    if (
      this.looseNot &&
      this.check(TokenType.NOT) &&
      this.peek().value === 'not'
    ) {
      this.advance()
      return UnaryExpr('!', this.parseNotOperand())
    }
    return this.parseBitwiseOr()
  }

  parseBitwiseOr() {
    let left = this.parseBitwiseXor()
    while (this.match(TokenType.PIPE)) {
      const right = this.parseBitwiseXor()
      left = BinaryExpr('|', left, right)
    }
    return left
  }

  parseBitwiseXor() {
    let left = this.parseBitwiseAnd()
    while (this.match(TokenType.CARET)) {
      const right = this.parseBitwiseAnd()
      left = BinaryExpr('^', left, right)
    }
    return left
  }

  parseBitwiseAnd() {
    let left = this.parseEquality()
    while (this.match(TokenType.AMP)) {
      const right = this.parseEquality()
      left = BinaryExpr('&', left, right)
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

  // `as` / `satisfies` lex as plain identifiers, so they only count as
  // a cast when they sit on the same line as the end of the previous
  // token and a type can follow. That keeps them usable as ordinary
  // names on a line of their own.
  isAsCast() {
    const tok = this.peek()
    if (
      tok.type !== TokenType.IDENTIFIER ||
      (tok.value !== 'as' && tok.value !== 'satisfies')
    ) {
      return false
    }
    const prev = this.tokens[this.pos - 1]
    const next = this.tokens[this.pos + 1]
    if (!prev || !next || prev.line !== tok.line) return false
    return (
      next.type === TokenType.IDENTIFIER ||
      next.type === TokenType.CONST ||
      next.type === TokenType.LBRACE ||
      next.type === TokenType.LBRACKET ||
      next.type === TokenType.LPAREN ||
      next.type === TokenType.STRING ||
      next.type === TokenType.NUMBER ||
      next.type === TokenType.TYPEOF ||
      next.type === TokenType.VOID ||
      next.type === TokenType.MINUS
    )
  }

  parseComparison() {
    let left = this.parsePredicate()
    while (true) {
      if (this.isAsCast()) {
        const keyword = this.advance().value // 'as' | 'satisfies'
        let type
        if (keyword === 'as' && this.match(TokenType.CONST)) {
          type = 'const'
        } else {
          type = this.parseTypeExpression()
        }
        left = AsExpr(left, type, keyword)
        continue
      }
      // `>>=` / `<<=` start with a GT/LT token; those belong to
      // parseAssignment, not to a comparison.
      if (COMPARISON_SYMBOLS[this.peek().type] && !this.compoundShiftAt()) {
        const operator = COMPARISON_SYMBOLS[this.advance().type]
        const right = this.parsePredicate()
        left = BinaryExpr(operator, left, right)
        continue
      }
      break
    }
    return left
  }

  parsePredicate() {
    const left = this.parseShift()

    if (this.match(TokenType.EXISTS)) {
      return BinaryExpr('!=', left, Literal(null))
    }
    if (this.match(TokenType.MISSING)) {
      return BinaryExpr('==', left, Literal(null))
    }
    if (this.match(TokenType.HAS)) {
      const right = this.parseShift()
      return hasExpr(left, right)
    }

    return left
  }

  parseShift() {
    let left = this.parseAdditive()
    let shift
    while ((shift = this.shiftOperatorAt())) {
      this.pos += shift.len
      const right = this.parseAdditive()
      left = BinaryExpr(shift.op, left, right)
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
    let left = this.parseExponent()
    while (MULTIPLICATIVE_SYMBOLS[this.peek().type]) {
      const operator = MULTIPLICATIVE_SYMBOLS[this.advance().type]
      const right = this.parseExponent()
      left = BinaryExpr(operator, left, right)
    }
    return left
  }

  // `**` binds tighter than * / % and is right-associative:
  // 2 ** 3 ** 2 is 2 ** (3 ** 2). The right side recurses into
  // parseExponent itself to get that associativity.
  parseExponent() {
    const base = this.parseUnary()
    if (this.match(TokenType.STAR_STAR)) {
      const exponent = this.parseExponent()
      return BinaryExpr('**', base, exponent)
    }
    return base
  }

  parseUnary() {
    if (this.match(TokenType.AWAIT)) {
      return AwaitExpr(this.parseUnary())
    }
    if (this.match(TokenType.NOT)) {
      return UnaryExpr('!', this.parseUnary())
    }
    if (this.match(TokenType.TILDE)) {
      return UnaryExpr('~', this.parseUnary())
    }
    if (this.match(TokenType.MINUS)) {
      return UnaryExpr('-', this.parseUnary())
    }
    if (this.match(TokenType.PLUS)) {
      return UnaryExpr('+', this.parseUnary())
    }
    if (this.match(TokenType.TYPEOF)) {
      return UnaryExpr('typeof', this.parseUnary())
    }
    if (this.match(TokenType.DELETE)) {
      return UnaryExpr('delete', this.parseUnary())
    }
    if (this.match(TokenType.VOID)) {
      return UnaryExpr('void', this.parseUnary())
    }
    if (this.match(TokenType.PLUS_PLUS)) {
      const target = this.parseUnary()
      this.assertTargetRunsOnce(target)
      return AssignmentExpr(target, BinaryExpr('+', target, Literal(1)))
    }
    if (this.match(TokenType.MINUS_MINUS)) {
      const target = this.parseUnary()
      this.assertTargetRunsOnce(target)
      return AssignmentExpr(target, BinaryExpr('-', target, Literal(1)))
    }

    const expr = this.parseMemberExpression()
    if (this.match(TokenType.PLUS_PLUS)) {
      this.assertTargetRunsOnce(expr)
      return AssignmentExpr(expr, BinaryExpr('+', expr, Literal(1)))
    }
    if (this.match(TokenType.MINUS_MINUS)) {
      this.assertTargetRunsOnce(expr)
      return AssignmentExpr(expr, BinaryExpr('-', expr, Literal(1)))
    }
    return expr
  }

  // The parts of a lexed template literal, with each ${...} span
  // parsed as an expression. Text parts keep both `value` (cooked)
  // and `raw`.
  templateLiteralFromParts(rawParts) {
    return TemplateLiteralExpr(
      rawParts.map((p) =>
        p.type === 'text'
          ? p
          : {
              type: 'expr',
              // Same language options as the enclosing parser, so
              // `${ not items has x }` follows the project's `not` mode.
              expression: parseExpressionString(p.source, this.options),
            },
      ),
    )
  }

  parseMemberExpression() {
    let expr = this.parsePrimary()
    while (true) {
      // Non-null assertion `x!` / `x!.y`: only when the `!` is written
      // directly against the previous token, so a prefix `!` or a
      // `not` on the next line is never taken for it.
      if (
        this.check(TokenType.NOT) &&
        this.peek().value === '!' &&
        adjacent(this.tokens[this.pos - 1], this.peek())
      ) {
        this.advance()
        expr = NonNullExpr(expr)
        continue
      }
      // Tagged template: tag`text ${x}`. Must start on the same line
      // as the tag, so a template literal on its own line is never
      // glued to the previous statement.
      if (this.check(TokenType.TEMPLATE_LITERAL)) {
        const prev = this.tokens[this.pos - 1]
        if (prev && prev.line === this.peek().line) {
          const quasi = this.templateLiteralFromParts(this.advance().value)
          expr = TaggedTemplateExpr(expr, quasi)
          continue
        }
      }
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
        // Optional call: fn?.(args)
        if (this.check(TokenType.LPAREN)) {
          expr = { ...CallExpr(expr, this.parseCallArguments()), optional: true }
          continue
        }
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
      // new.target
      if (this.check(TokenType.DOT)) {
        this.advance()
        const prop = this.parsePropertyName("after 'new.'")
        if (prop !== 'target') {
          throw new Error(
            `Expected 'new.target' at line ${this.peek().line}, got 'new.${prop}'`,
          )
        }
        return Identifier('new.target')
      }
      let callee = this.parsePrimary()
      while (this.match(TokenType.DOT)) {
        const property = this.parsePropertyName("after '.'")
        callee = MemberExpr(callee, property)
      }
      let args = []
      if (this.check(TokenType.LPAREN)) {
        args = this.parseCallArguments()
      }
      return NewExpr(callee, args)
    }

    // function (a, b) { ... } / async function* name(a) { ... }
    if (this.isFunctionKeywordAhead()) {
      const isAsync = this.match(TokenType.ASYNC)
      const fn = this.parseFunctionRest(isAsync)
      return FunctionExpr(fn.params, fn.body, fn.isAsync, fn.name, fn.isGenerator)
    }

    // class { ... } / class Name extends Base { ... } as an expression
    if (this.isClassAhead(true)) {
      return this.parseClass(true)
    }

    // Regex literal. String(regex) yields "/pattern/flags", which
    // every generator already emits for Literal nodes, so no codegen
    // changes are needed.
    if (this.check(TokenType.REGEX)) {
      const tok = this.advance()
      try {
        return Literal(new RegExp(tok.value.pattern, tok.value.flags))
      } catch (err) {
        throw new Error(
          `Invalid regular expression at line ${tok.line}: ${err.message}`,
        )
      }
    }

    // 10n -> BigInt("10"), so every generator handles it as a normal
    // call to the BigInt global.
    if (this.check(TokenType.BIGINT)) {
      const text = this.advance().value
      return CallExpr(Identifier('BigInt'), [Literal(text)])
    }

    if (this.check(TokenType.NUMBER) || this.check(TokenType.STRING)) {
      return Literal(this.advance().value)
    }

    if (this.check(TokenType.TEMPLATE_LITERAL)) {
      return this.templateLiteralFromParts(this.advance().value)
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
      // every downstream consumer treats them correctly by construction.
      if (name === 'null') return Literal(null)
      if (name === 'undefined') return Literal(undefined)
      if (name === 'true') return Literal(true)
      if (name === 'false') return Literal(false)
      return Identifier(name)
    }

    // Grouping, and the comma operator: (a, b, c)
    if (this.match(TokenType.LPAREN)) {
      let expr = this.parseExpression()
      if (this.check(TokenType.COMMA)) {
        const expressions = [expr]
        while (this.match(TokenType.COMMA)) {
          expressions.push(this.parseExpression())
        }
        expr = SequenceExpr(expressions)
      }
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
  // AST -- Tylix's own codegen never interprets them, it only needs
  // the exact TS source text to paste into the virtual .ts file handed
  // to the TypeScript compiler API.
  //
  // Supported: names (Foo, Foo.Bar), generics (Map<string, Post[]>),
  // unions and intersections, arrays and indexed access (T[], T[K]),
  // string/number literal types ("asc" | "desc", 1 | 2), tuples
  // ([string, number]), object types (with index signatures and method
  // signatures), function types ((id: number) => void), grouped types,
  // keyof / typeof / readonly prefixes, void/null/undefined.
  parseTypeExpression() {
    this.match(TokenType.PIPE) // leading "|" of a multi-line union
    let left = this.parseIntersectionType()
    while (this.match(TokenType.PIPE)) {
      left = `${left} | ${this.parseIntersectionType()}`
    }
    return left
  }

  parseIntersectionType() {
    this.match(TokenType.AMP) // leading "&"
    let left = this.parseTypeOperand()
    while (this.match(TokenType.AMP)) {
      left = `${left} & ${this.parseTypeOperand()}`
    }
    return left
  }

  parseTypeOperand() {
    const tok = this.peek()

    if (tok.type === TokenType.TYPEOF) {
      this.advance()
      let name = this.parseNameToken("Expected a name after 'typeof'")
      while (this.match(TokenType.DOT)) {
        name += `.${this.parsePropertyName("after '.'")}`
      }
      return this.parseTypeSuffixes(`typeof ${name}`)
    }

    let prefix = ''
    if (
      tok.type === TokenType.IDENTIFIER &&
      (tok.value === 'keyof' || tok.value === 'readonly')
    ) {
      const next = this.tokens[this.pos + 1]
      if (
        next &&
        (next.type === TokenType.IDENTIFIER ||
          next.type === TokenType.LBRACE ||
          next.type === TokenType.LPAREN ||
          next.type === TokenType.LBRACKET ||
          next.type === TokenType.TYPEOF)
      ) {
        this.advance()
        prefix = `${tok.value} `
      }
    }

    return this.parseTypeSuffixes(prefix + this.parsePrimaryType())
  }

  // `T[]` and indexed access `T[K]`
  parseTypeSuffixes(type) {
    while (this.check(TokenType.LBRACKET)) {
      this.advance()
      if (this.match(TokenType.RBRACKET)) {
        type = `${type}[]`
      } else {
        const index = this.parseTypeExpression()
        this.expect(
          TokenType.RBRACKET,
          "Expected ']' to close indexed access type",
        )
        type = `${type}[${index}]`
      }
    }
    return type
  }

  parsePrimaryType() {
    const tok = this.peek()

    if (tok.type === TokenType.STRING) {
      this.advance()
      return JSON.stringify(tok.value)
    }
    if (tok.type === TokenType.NUMBER) {
      this.advance()
      return String(tok.value)
    }
    if (
      tok.type === TokenType.MINUS &&
      this.tokens[this.pos + 1]?.type === TokenType.NUMBER
    ) {
      this.advance()
      return `-${this.advance().value}`
    }
    if (tok.type === TokenType.LBRACE) {
      return this.parseObjectTypeLiteral()
    }
    if (tok.type === TokenType.LBRACKET) {
      return this.parseTupleType()
    }
    if (tok.type === TokenType.LPAREN) {
      // `(a: T) => R` is a function type; anything else in parens is
      // a grouped type like `(A | B)[]`.
      const fn = this.tryParseFunctionType()
      if (fn !== null) return fn
      this.advance()
      const inner = this.parseTypeExpression()
      this.expect(TokenType.RPAREN, "Expected ')' to close grouped type")
      return `(${inner})`
    }

    // `void` is a keyword token but a perfectly good type name.
    if (tok.type !== TokenType.IDENTIFIER && tok.type !== TokenType.VOID) {
      throw new Error(
        `Expected a type name at line ${tok.line}, got ${tok.type}`,
      )
    }
    this.advance()
    let name = tok.value
    while (this.match(TokenType.DOT)) {
      name += `.${this.parsePropertyName("after '.'")}`
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

  // `(a: T, b?: U, ...rest: V[])` -> "a: T, b?: U, ...rest: V[]"
  parseTypeParamList() {
    this.expect(TokenType.LPAREN, "Expected '(' to start a parameter list")
    const params = []
    while (!this.check(TokenType.RPAREN)) {
      const rest = this.match(TokenType.SPREAD)
      const name = this.parseNameToken('Expected a parameter name')
      const optional = this.match(TokenType.QUESTION)
      this.expect(TokenType.COLON, "Expected ':' after parameter name")
      const type = this.parseTypeExpression()
      params.push(`${rest ? '...' : ''}${name}${optional ? '?' : ''}: ${type}`)
      if (!this.match(TokenType.COMMA)) break
    }
    this.expect(TokenType.RPAREN, "Expected ')' to close a parameter list")
    return params.join(', ')
  }

  // Speculative: restores the position and returns null when the
  // parens turn out to be a grouped type instead.
  tryParseFunctionType() {
    const savedPos = this.pos
    try {
      const params = this.parseTypeParamList()
      this.expect(TokenType.ARROW, "Expected '=>' in function type")
      const returnType = this.parseTypeExpression()
      return `(${params}) => ${returnType}`
    } catch {
      this.pos = savedPos
      return null
    }
  }

  parseTupleType() {
    this.expect(TokenType.LBRACKET, "Expected '[' to start a tuple type")
    const members = []
    while (!this.check(TokenType.RBRACKET)) {
      const rest = this.match(TokenType.SPREAD)
      let member = this.parseTypeExpression()
      if (this.match(TokenType.QUESTION)) member += '?'
      members.push(`${rest ? '...' : ''}${member}`)
      if (!this.match(TokenType.COMMA)) break
    }
    this.expect(TokenType.RBRACKET, "Expected ']' to close a tuple type")
    return `[${members.join(', ')}]`
  }

  parseObjectTypeLiteral() {
    this.expect(TokenType.LBRACE, "Expected '{' to start object type")
    const members = []
    while (!this.check(TokenType.RBRACE)) {
      if (this.check(TokenType.LBRACKET)) {
        // index signature: [key: string]: T
        this.advance()
        const keyName = this.parseNameToken('Expected an index signature name')
        this.expect(TokenType.COLON, "Expected ':' in index signature")
        const keyType = this.parseTypeExpression()
        this.expect(TokenType.RBRACKET, "Expected ']' to close index signature")
        this.expect(TokenType.COLON, "Expected ':' after index signature")
        const valueType = this.parseTypeExpression()
        members.push(`[${keyName}: ${keyType}]: ${valueType}`)
      } else {
        const key = this.check(TokenType.STRING)
          ? JSON.stringify(this.advance().value)
          : this.parseNameToken('Expected a property name')
        const optional = this.match(TokenType.QUESTION)

        if (this.check(TokenType.LPAREN)) {
          // method signature: name(a: T): R
          const params = this.parseTypeParamList()
          let returnType = 'any'
          if (this.match(TokenType.COLON)) {
            returnType = this.parseTypeExpression()
          }
          members.push(`${key}${optional ? '?' : ''}(${params}): ${returnType}`)
        } else {
          this.expect(
            TokenType.COLON,
            "Expected ':' after property name in object type",
          )
          const valueType = this.parseTypeExpression()
          members.push(`${key}${optional ? '?' : ''}: ${valueType}`)
        }
      }
      if (!this.match(TokenType.COMMA)) this.match(TokenType.SEMICOLON)
    }
    this.expect(TokenType.RBRACE, "Expected '}' to close object type")
    return `{ ${members.join('; ')} }`
  }

  // Array literal after the opening '['. A comma with nothing before
  // it is a hole (`[1, , 3]`), stored as `null` in `elements`.
  parseArrayLiteral() {
    const elements = []
    while (!this.check(TokenType.RBRACKET)) {
      if (this.check(TokenType.COMMA)) {
        elements.push(null)
        this.advance()
        continue
      }
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

  // Object literal after the opening '{'. Supports:
  //   { a: 1, "b-c": 2, 3: 'x' }      plain / string / number keys
  //   { name }                        shorthand
  //   { ...base }                     spread
  //   { [expr]: value }               computed keys
  //   { save(x) { ... } }             method shorthand
  //   { async load() { ... } }        async method shorthand
  //   { *items() { ... } }            generator method (also async *)
  //   { get total() { ... } }         getter
  //   { set total(v) { ... } }        setter
  parseObjectLiteral() {
    const properties = []
    while (!this.check(TokenType.RBRACE)) {
      // Object spread: represented as a property with `spread: true`
      // and no key, so codegen must check `p.spread` first.
      if (this.match(TokenType.SPREAD)) {
        properties.push({
          key: null,
          spread: true,
          value: this.parseExpression(),
        })
        this.match(TokenType.COMMA)
        continue
      }

      // `get name() {}` / `set name(v) {}`. `{ get }`, `{ get: 1 }`,
      // `{ get, set }` and `get() {}` stay ordinary keys/methods.
      let accessorKind = null
      if (
        this.check(TokenType.IDENTIFIER) &&
        (this.peek().value === 'get' || this.peek().value === 'set')
      ) {
        const word = this.peek()
        const n = this.tokens[this.pos + 1]
        if (
          n &&
          n.line === word.line &&
          (n.type === TokenType.IDENTIFIER ||
            KEYWORD_TOKEN_TYPES.has(n.type) ||
            n.type === TokenType.STRING ||
            n.type === TokenType.NUMBER ||
            n.type === TokenType.LBRACKET)
        ) {
          accessorKind = word.value
          this.advance()
        }
      }

      // `async name(...) { }` -- but `async: x`, `async,` and `async()`
      // are ordinary keys/methods named "async".
      let isAsync = false
      if (!accessorKind && this.check(TokenType.ASYNC)) {
        const n = this.tokens[this.pos + 1]
        if (
          n &&
          n.type !== TokenType.COLON &&
          n.type !== TokenType.COMMA &&
          n.type !== TokenType.RBRACE &&
          n.type !== TokenType.LPAREN
        ) {
          this.advance()
          isAsync = true
        }
      }

      // `*name() { }` generator method
      let isGenerator = false
      if (!accessorKind && this.match(TokenType.STAR)) {
        isGenerator = true
      }

      let key = null
      let keyExpr = null
      let keyKind = 'name'
      if (this.match(TokenType.LBRACKET)) {
        keyExpr = this.parseExpression()
        this.expect(
          TokenType.RBRACKET,
          "Expected ']' to close a computed object key",
        )
        keyKind = 'computed'
      } else if (this.check(TokenType.STRING)) {
        key = this.advance().value
        keyKind = 'string'
      } else if (this.check(TokenType.NUMBER)) {
        key = String(this.advance().value)
        keyKind = 'number'
      } else if (
        this.check(TokenType.IDENTIFIER) ||
        KEYWORD_TOKEN_TYPES.has(this.peek().type)
      ) {
        key = this.advance().value
      } else {
        throw new Error(
          `Expected an object key at line ${this.peek().line}, got ${this.peek().type}`,
        )
      }

      // Method shorthand / accessor
      if (this.check(TokenType.LPAREN)) {
        this.advance()
        const params = this.parseParamList()
        if (this.match(TokenType.COLON)) this.parseTypeExpression()
        const body = this.withGenerator(isGenerator, () =>
          this.parseBlockStatements('method body'),
        )
        properties.push({
          key,
          keyExpr,
          method: true,
          kind: accessorKind ?? 'method',
          value: FunctionExpr(params, body, isAsync, null, isGenerator),
        })
        this.match(TokenType.COMMA)
        continue
      }

      if (isAsync || isGenerator || accessorKind) {
        throw new Error(
          `Expected '(' after the method name at line ${this.peek().line}`,
        )
      }

      if (keyKind === 'name' && !this.check(TokenType.COLON)) {
        // Shorthand: { name } means { name: name }
        properties.push({ key, value: Identifier(key) })
        this.match(TokenType.COMMA)
        continue
      }

      this.expect(TokenType.COLON, "Expected ':' after object key")
      const value = this.parseExpression()
      properties.push({ key, keyExpr, value })
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