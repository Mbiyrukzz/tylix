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
  helpers = [],
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
    helpers,
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
//   name            plain name, or destructuring source text ("{ a, b }")
//   typeAnnotation  TS type text or null
//   defaultValue    expression node or null
//   rest            true for `...name`
//   optional        true for `name?: Type`
export function Param(
  name,
  typeAnnotation = null,
  defaultValue = null,
  rest = false,
  optional = false,
) {
  return { name, typeAnnotation, defaultValue, rest, optional }
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
// [{ name, init, typeAnnotation }]. init may be null for `let x`.
// typeAnnotation (TS type text or null) belongs to the FIRST declarator;
// extra declarators carry their own in `more[i].typeAnnotation`.
export function VariableDeclaration(
  kind,
  name,
  init,
  more = [],
  typeAnnotation = null,
) {
  return { type: 'VariableDeclaration', kind, name, init, more, typeAnnotation }
}

export function ObjectExpr(properties) {
  // properties: [{ key, value }]            plain
  //             [{ key: null, keyExpr, value }]   computed key
  //             [{ key, keyExpr, method: true, kind: 'method' | 'get' | 'set',
  //                value: FunctionExpr }]   method shorthand / accessors
  //             [{ key: null, spread: true, value }]
  return { type: 'ObjectExpression', properties }
}

// elements may contain `null` for array holes: [1, , 3]
export function ArrayExpr(elements) {
  return { type: 'ArrayExpression', elements }
}

export function IfStatement(condition, consequent, alternate) {
  return { type: 'IfStatement', condition, consequent, alternate }
}

export function UnaryExpr(operator, argument) {
  return { type: 'UnaryExpression', operator, argument }
}

// `++x` / `x++` / `--x` / `x--`. Kept as its own node (not desugared to
// `x = x + 1`) so a postfix update evaluates to the old value.
export function UpdateExpr(operator, argument, prefix) {
  return { type: 'UpdateExpression', operator, argument, prefix }
}

export function NullishCoalescingExpr(left, right) {
  return { type: 'NullishCoalescingExpression', left, right }
}

export function TernaryExpr(condition, consequent, alternate) {
  return { type: 'TernaryExpression', condition, consequent, alternate }
}

// varName: a plain name or a destructuring pattern node. declKind is
// 'const' (default) or 'let'. Iterates VALUES (for...of). isAwait
// marks `for await (... of ...)`.
export function ForInStatement(
  varName,
  iterable,
  body,
  declKind = 'const',
  isAwait = false,
) {
  return { type: 'ForInStatement', varName, iterable, body, declKind, isAwait }
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

// label is the target of `break outer` / `continue outer`, or null.
export function BreakStatement(label = null) {
  return { type: 'BreakStatement', label }
}

export function ContinueStatement(label = null) {
  return { type: 'ContinueStatement', label }
}

// `outer: for (...) { ... }`
export function LabeledStatement(label, body) {
  return { type: 'LabeledStatement', label, body }
}

export function DebuggerStatement() {
  return { type: 'DebuggerStatement' }
}

export function ArrowFunctionExpr(
  params,
  body,
  paramTypes = null,
  isAsync = false,
  paramDefaults = null,
  paramOptional = null,
  returnType = null,
) {
  // body is either an expression node, or a BlockStatement node for
  // block-bodied arrows (`x => { ... }`). Block bodies are only valid
  // in script code; the template generators reject BlockStatement
  // with a clear error.
  // isAsync marks `async x => ...` / `async (a, b) => ...`.
  // params are source strings ("x", "[k, v]", "{ id }", "...rest");
  // paramDefaults is a parallel array of expression nodes or null;
  // paramOptional is a parallel array of booleans (`b?: string`);
  // returnType is TS type text or null (`(x): number => ...`).
  return {
    type: 'ArrowFunctionExpression',
    params,
    body,
    paramTypes,
    isAsync,
    paramDefaults,
    paramOptional,
    returnType,
  }
}

// `function name(a, b = 1, ...rest) { ... }` used as an expression
// (also the value of object-literal methods and accessors).
// isGenerator marks `function*`. Script only.
export function FunctionExpr(
  params,
  body,
  isAsync = false,
  name = null,
  isGenerator = false,
) {
  return { type: 'FunctionExpression', params, body, isAsync, name, isGenerator }
}

export function FunctionDeclaration(
  name,
  params,
  body,
  isAsync = false,
  isGenerator = false,
) {
  return {
    type: 'FunctionDeclaration',
    name,
    params,
    body,
    isAsync,
    isGenerator,
  }
}

export function TemplateLiteralExpr(parts) {
  return { type: 'TemplateLiteralExpression', parts }
}

// tag`text ${x}` -- quasi is a TemplateLiteralExpression whose text
// parts carry `raw` (the text as written) for String.raw.
export function TaggedTemplateExpr(tag, quasi) {
  return { type: 'TaggedTemplateExpression', tag, quasi }
}

export function SpreadElement(argument) {
  return { type: 'SpreadElement', argument }
}

// `(a, b, c)` -- the comma operator.
export function SequenceExpr(expressions) {
  return { type: 'SequenceExpression', expressions }
}

// `yield x` / `yield* x` / bare `yield` (argument null).
export function YieldExpr(argument, delegate = false) {
  return { type: 'YieldExpression', argument, delegate }
}

// `expr as Type` / `expr satisfies Type` -- the cast exists only in
// the virtual .ts file; real JS output is just the inner expression.
export function AsExpr(expression, typeAnnotation, keyword = 'as') {
  return { type: 'AsExpression', expression, typeAnnotation, keyword }
}

// `expr!` -- non-null assertion, same deal: .ts only.
export function NonNullExpr(expression) {
  return { type: 'NonNullExpression', expression }
}

// members: see Parser.parseClassMember. Each is
//   { kind: 'constructor' | 'method' | 'get' | 'set' | 'field' | 'staticBlock',
//     static, key, keyExpr, keyKind: 'name' | 'string' | 'number' | 'computed',
//     isAsync, isGenerator, params, body, returnType, typeAnnotation, value }
export function ClassDeclaration(name, superClass, members) {
  return { type: 'ClassDeclaration', name, superClass, members }
}

export function ClassExpr(name, superClass, members) {
  return { type: 'ClassExpression', name, superClass, members }
}

// catchParam: null, a plain name, or a destructuring pattern node.
// catchType: optional `any` / `unknown` written after a plain name.
export function TryStatement(
  tryBlock,
  catchParam,
  catchBlock,
  finallyBlock,
  catchType = null,
) {
  return {
    type: 'TryStatement',
    tryBlock,
    catchParam,
    catchType,
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

// `type X = ...` / `interface X {...}`. `source` is the full TS text;
// it only appears in the virtual .ts file, never in real JS output.
export function TypeDeclaration(kind, name, source) {
  return { type: 'TypeDeclaration', kind, name, source }
}

// members: [{ name, init: expression | null }]
export function EnumDeclaration(name, members) {
  return { type: 'EnumDeclaration', name, members }
}
// {{#await promise}}pending{{#then value}}…{{#catch error}}…{{/await}}
// and the short form {{#await promise then value}}…{{/await}}.
// pending/thenChildren/catchChildren are null when the block has no
// such branch; thenName/catchName are null when nothing is bound.
export function AwaitNode(promise, pending, thenName, thenChildren, catchName, catchChildren) {
  return { type: 'Await', promise, pending, thenName, thenChildren, catchName, catchChildren }
}

// {{@html expr}}: trusted HTML inserted as markup.
export function RawHtmlNode(expression) {
  return { type: 'RawHtml', expression }
}
