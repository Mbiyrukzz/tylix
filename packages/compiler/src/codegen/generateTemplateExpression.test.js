import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTemplateExpression } from "./generateTemplateExpression.js";
import { Identifier, BinaryExpr, MemberExpr, Literal } from "../ast/nodes.js";

test("prefixes a bare identifier with instance.", () => {
  assert.equal(generateTemplateExpression(Identifier("count")), "instance.count");
});

test("prefixes the root of a member expression", () => {
  const node = MemberExpr(Identifier("user"), "name");
  assert.equal(generateTemplateExpression(node), "instance.user.name");
});

test("prefixes both sides of a binary expression", () => {
  const node = BinaryExpr("*", Identifier("count"), Literal(2));
  assert.equal(generateTemplateExpression(node), "(instance.count * 2)");
});

test("passes through a bare literal unchanged", () => {
  assert.equal(generateTemplateExpression(Literal(42)), "42");
});

test("leaves a scoped identifier bare instead of prefixing with instance.", () => {
  const scope = new Set(["post"]);
  const node = MemberExpr(Identifier("post"), "title");
  assert.equal(generateTemplateExpression(node, scope), "post.title");
});

test("still prefixes identifiers not in scope", () => {
  const scope = new Set(["post"]);
  const node = Identifier("count");
  assert.equal(generateTemplateExpression(node, scope), "instance.count");
});
