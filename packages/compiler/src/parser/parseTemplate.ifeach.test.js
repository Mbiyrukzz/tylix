import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTemplate } from "./parseTemplate.js";

test("parses an {{#if}} block", () => {
  const nodes = parseTemplate(`{{#if isVisible}}<p>Shown</p>{{/if}}`);
  assert.equal(nodes[0].type, "If");
  assert.equal(nodes[0].children[0].tag, "p");
});

test("parses an {{#each}} block with item in items syntax", () => {
  const nodes = parseTemplate(`{{#each post in posts}}<li>{{ post.title }}</li>{{/each}}`);
  assert.equal(nodes[0].type, "Each");
  assert.equal(nodes[0].itemName, "post");
  assert.equal(nodes[0].iterable.name, "posts");
  assert.equal(nodes[0].children[0].tag, "li");
});

test("parses nested if inside each", () => {
  const nodes = parseTemplate(
    `{{#each post in posts}}{{#if post.published}}<span>{{ post.title }}</span>{{/if}}{{/each}}`
  );
  assert.equal(nodes[0].type, "Each");
  assert.equal(nodes[0].children[0].type, "If");
});

test("throws on an unclosed {{#if}} block", () => {
  assert.throws(() => parseTemplate(`{{#if x}}<p>Hi</p>`), /Unclosed block/);
});

test("throws on a malformed {{#each}} header", () => {
  assert.throws(() => parseTemplate(`{{#each posts}}<li></li>{{/each}}`), /expected "item in items"/);
});
