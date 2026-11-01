/**
 * Plain-object AST node factories for the Tylix script grammar.
 * Every node has a `type` discriminator so the codegen stage (and
 * later, the Analyzer) can switch on it without instanceof checks.
 */
export function PageNode({
  title = null,
  layout = null,
  needs = [],
  props = [],
  state = [],
  uses = [],
  prefetch = [],
  background = [],
  permissions = [],
  meta = [],
  computed = [],
  actions = [],
  onMount = null,
}) {
  return {
    type: 'Page',
    title,
    layout,
    needs,
    props,
    state,
    uses,
    prefetch,
    background,
    permissions,
    meta,
    computed,
    actions,
    onMount,
  }
}

export function CapabilityRefNode(capability, member, args = null) {
  // args === null means it's a bare reference (needs/uses entries: `Auth`)
  // args !== null (possibly []) means it's a call (prefetch/background: `Posts.latest`, `Posts.search("x")`)
  return { type: 'CapabilityRef', capability, member, args }
}

export function MetaEntryNode(key, value) {
  return { type: 'MetaEntry', key, value }
}

export function PropNode(name, propType, optional = false) {
  return { type: 'Prop', name, propType, optional }
}

export function StateNode(name, value, typeAnnotation = null) {
  return { type: 'State', name, value, typeAnnotation }
}

export function MethodNode(name, params, body, returnType = null) {
  return { type: 'Method', name, params, body, returnType }
}

// A function/method parameter:
//   name          plain name, or destructuring source text ("{ a, b }")
//   typeAnnotation  TS type text or null
//   defaultValue  expression node or null
//   rest          true for `...name`
export function Param(
  name,
  typeAnnotation = null,
  defaultValue = null,
  rest = false,
) {
  return { name, typeAnnotation, defaultValue, rest }
}

export function AssignmentExpr(target, value) {
  return { type: 'AssignmentExpression', target, value }
}

export function BinaryExpr(operator, left, right) {
  return { type: 'BinaryExpression', operator, left, right }
}

export function Identifier(name) {
  return { type: 'Identifier', name }
}

export function ObjectPattern(properties, rest = null) {
  return { type: 'ObjectPattern', properties, rest }
}

export function ArrayPattern(elements, rest = null) {
  return { type: 'ArrayPattern', elements, rest }
}

export function MemberExpr(
  object,
  property,
  computed = false,
  optional = false,
) {
  return { type: 'MemberExpression', object, property, computed, optional }
}

export function NewExpr(callee, args) {
  return { type: 'NewExpression', callee, args }
}

export function Literal(value) {
  return { type: 'Literal', value }
}

export function ReturnStatement(argument) {
  return { type: 'ReturnStatement', argument }
}

export function ExpressionStatement(expression) {
  return { type: 'ExpressionStatement', expression }
}

export function EmptyStatement() {
  return { type: 'EmptyStatement' }
}

export function ElementNode(tag, attributes, children) {
  return { type: 'Element', tag, attributes, children }
}

export function AttributeNode(name, value, dynamic) {
  return { type: 'Attribute', name, value, dynamic }
}

export function TextNode(value) {
  return { type: 'Text', value }
}

export function InterpolationNode(expression) {
  return { type: 'Interpolation', expression }
}

// elseChildren: null, or the nodes of the {{#else}} branch. An
// `{{#else if c}}` is represented as elseChildren = [IfNode(...)].
export function IfNode(condition, children, elseChildren = null) {
  return { type: 'If', condition, children, elseChildren }
}

// itemName may be a plain name or destructuring source text
// ("[k, v]", "{ id, name }"). indexName is the optional second binding
// of `{{#each item, i in items}}`. elseChildren renders when the list
// is empty.
export function EachNode(
  itemName,
  iterable,
  children,
  indexName = null,
  elseChildren = null,
) {
  return {
    type: 'Each',
    itemName,
    iterable,
    children,
    indexName,
    elseChildren,
  }
}

export function CallExpr(callee, args) {
  return { type: 'CallExpression', callee, args }
}

export function AwaitExpr(argument) {
  return { type: 'AwaitExpression', argument }
}

// `more` holds extra declarators of `const a = 1, b = 2`:
// [{ name, init }]. init may be null for `let x`.
export function VariableDeclaration(kind, name, init, more = []) {
  return { type: 'VariableDeclaration', kind, name, init, more }
}

export function ObjectExpr(properties) {
  // properties: [{ key, value }]            plain
  //             [{ key: null, keyExpr, value }]   computed key
  //             [{ key, keyExpr, method: true, value: FunctionExpr }]
  //             [{ key: null, spread: true, value }]
  return { type: 'ObjectExpression', properties }
}

export function ArrayExpr(elements) {
  return { type: 'ArrayExpression', elements }
}

export function IfStatement(condition, consequent, alternate) {
  return { type: 'IfStatement', condition, consequent, alternate }
}

export function UnaryExpr(operator, argument) {
  return { type: 'UnaryExpression', operator, argument }
}

export function NullishCoalescingExpr(left, right) {
  return { type: 'NullishCoalescingExpression', left, right }
}

export function TernaryExpr(condition, consequent, alternate) {
  return { type: 'TernaryExpression', condition, consequent, alternate }
}

// varName: a plain name or a destructuring pattern node. declKind is
// 'const' (default) or 'let'. Iterates VALUES (for...of).
export function ForInStatement(varName, iterable, body, declKind = 'const') {
  return { type: 'ForInStatement', varName, iterable, body, declKind }
}

// JS `for (const k in obj)` -- iterates KEYS.
export function ForKeysStatement(varName, object, body, declKind = 'const') {
  return { type: 'ForKeysStatement', varName, object, body, declKind }
}

// C-style `for (init; test; update) { }`
//   init:   VariableDeclaration | { type: 'ExpressionList', expressions } | null
//   test:   expression | null
//   update: expression[]
export function ForStatement(init, test, update, body) {
  return { type: 'ForStatement', init, test, update, body }
}

export function ForRangeStatement(varName, start, end, body) {
  return { type: 'ForRangeStatement', varName, start, end, body }
}

export function RepeatStatement(count, body) {
  return { type: 'RepeatStatement', count, body }
}

export function BreakStatement() {
  return { type: 'BreakStatement' }
}

export function ContinueStatement() {
  return { type: 'ContinueStatement' }
}

export function ArrowFunctionExpr(
  params,
  body,
  paramTypes = null,
  isAsync = false,
  paramDefaults = null,
) {
  // body is either an expression node, or a BlockStatement node for
  // block-bodied arrows (`x => { ... }`). Block bodies are only valid
  // in script code; the template generators reject BlockStatement
  // with their normal "unsupported node type" error.
  // isAsync marks `async x => ...` / `async (a, b) => ...`.
  // params are source strings ("x", "[k, v]", "{ id }", "...rest");
  // paramDefaults is a parallel array of expression nodes or null.
  return {
    type: 'ArrowFunctionExpression',
    params,
    body,
    paramTypes,
    isAsync,
    paramDefaults,
  }
}

// `function name(a, b = 1, ...rest) { ... }` used as an expression
// (also the value of object-literal method shorthand). Script only.
export function FunctionExpr(params, body, isAsync = false, name = null) {
  return { type: 'FunctionExpression', params, body, isAsync, name }
}

export function FunctionDeclaration(name, params, body, isAsync = false) {
  return { type: 'FunctionDeclaration', name, params, body, isAsync }
}

export function TemplateLiteralExpr(parts) {
  return { type: 'TemplateLiteralExpression', parts }
}

export function SpreadElement(argument) {
  return { type: 'SpreadElement', argument }
}

export function TryStatement(tryBlock, catchParam, catchBlock, finallyBlock) {
  return {
    type: 'TryStatement',
    tryBlock,
    catchParam,
    catchBlock,
    finallyBlock,
  }
}

export function BlockStatement(body) {
  return { type: 'BlockStatement', body }
}

export function ThrowStatement(argument) {
  return { type: 'ThrowStatement', argument }
}

export function WhileStatement(condition, body) {
  return { type: 'WhileStatement', condition, body }
}

export function DoWhileStatement(body, condition) {
  return { type: 'DoWhileStatement', body, condition }
}

// cases: [{ tests: Expression[] | null, body: Statement[] }]
// tests === null marks the `default` clause.
export function SwitchStatement(discriminant, cases) {
  return { type: 'SwitchStatement', discriminant, cases }
}