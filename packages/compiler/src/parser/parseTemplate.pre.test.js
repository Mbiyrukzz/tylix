import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTemplate } from "./parseTemplate.js";

test("preserves exact whitespace and newlines inside <pre>", () => {
  const source = `<pre>line one
  line two (indented)
line three</pre>`;
  const nodes = parseTemplate(source);
  const preNode = nodes[0];
  assert.equal(preNode.tag, "pre");
  assert.equal(preNode.children[0].value, "line one\n  line two (indented)\nline three");
});

test("does not interpret {{ }} syntax inside <pre> as real interpolation/control-flow", () => {
  const source = `<pre>{{#each post in posts}}
  {{ post.title }}
{{/each}}</pre>`;
  const nodes = parseTemplate(source);
  const preNode = nodes[0];
  assert.equal(preNode.children.length, 1);
  assert.equal(preNode.children[0].type, "Text");
  assert.match(preNode.children[0].value, /\{\{#each post in posts\}\}/);
});

test("throws a clear error on an unclosed <pre> tag", () => {
  assert.throws(() => parseTemplate(`<pre>never closed`), /Unclosed <pre> tag/);
});

test("<pre> sits correctly alongside normal interpreted siblings", () => {
  const source = `<div><h1>{{ title }}</h1><pre>{{ raw }}</pre></div>`;
  const nodes = parseTemplate(source);
  const div = nodes[0];
  assert.equal(div.children[0].tag, "h1");
  assert.equal(div.children[0].children[0].type, "Interpolation");
  assert.equal(div.children[1].tag, "pre");
  assert.equal(div.children[1].children[0].type, "Text");
  assert.equal(div.children[1].children[0].value, "{{ raw }}");
});
