/**
 * Plain-object AST node factories for the Tylix script grammar.
 * Every node has a `type` discriminator so the codegen stage (and
 * later, the Analyzer) can switch on it without instanceof checks.
 */
export function PageNode({ props = [], state = [], computed = [], actions = [], onMount = null }) {
  return { type: "Page", props, state, computed, actions, onMount };
}

export function PropNode(name, propType) {
  return { type: "Prop", name, propType };
}

export function StateNode(name, value) {
  return { type: "State", name, value };
}

export function MethodNode(name, params, body) {
  return { type: "Method", name, params, body };
}

export function AssignmentExpr(target, value) {
  return { type: "AssignmentExpression", target, value };
}

export function BinaryExpr(operator, left, right) {
  return { type: "BinaryExpression", operator, left, right };
}

export function Identifier(name) {
  return { type: "Identifier", name };
}

export function MemberExpr(object, property) {
  return { type: "MemberExpression", object, property };
}

export function Literal(value) {
  return { type: "Literal", value };
}

export function ReturnStatement(argument) {
  return { type: "ReturnStatement", argument };
}

export function ExpressionStatement(expression) {
  return { type: "ExpressionStatement", expression };
}

export function ElementNode(tag, attributes, children) {
  return { type: "Element", tag, attributes, children };
}

export function AttributeNode(name, value, dynamic) {
  return { type: "Attribute", name, value, dynamic };
}

export function TextNode(value) {
  return { type: "Text", value };
}

export function InterpolationNode(expression) {
  return { type: "Interpolation", expression };
}

export function IfNode(condition, children) {
  return { type: "If", condition, children };
}

export function EachNode(itemName, iterable, children) {
  return { type: "Each", itemName, iterable, children };
}

export function CallExpr(callee, args) {
  return { type: "CallExpression", callee, args };
}

export function AwaitExpr(argument) {
  return { type: "AwaitExpression", argument };
}

export function VariableDeclaration(kind, name, init) {
  return { type: "VariableDeclaration", kind, name, init };
}

export function ObjectExpr(properties) {
  // properties: [{ key, value }]
  return { type: "ObjectExpression", properties };
}

export function ArrayExpr(elements) {
  return { type: "ArrayExpression", elements };
}
