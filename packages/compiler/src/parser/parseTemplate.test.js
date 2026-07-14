import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTemplate } from "./parseTemplate.js";

test("parses a single element with text content", () => {
  const nodes = parseTemplate(`<h1>Hello</h1>`);
  assert.deepEqual(nodes, [
    { type: "Element", tag: "h1", attributes: [], children: [{ type: "Text", value: "Hello" }] },
  ]);
});

test("parses an interpolation node", () => {
  const nodes = parseTemplate(`{{ count }}`);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "Interpolation");
  assert.deepEqual(nodes[0].expression, { type: "Identifier", name: "count" });
});

test("parses text and interpolation mixed in one element", () => {
  const nodes = parseTemplate(`<p>Count: {{ count }}</p>`);
  const p = nodes[0];
  assert.equal(p.children.length, 2);
  assert.deepEqual(p.children[0], { type: "Text", value: "Count: " });
  assert.equal(p.children[1].type, "Interpolation");
});

test("parses nested elements", () => {
  const nodes = parseTemplate(`<div><h1>Title</h1><p>Body</p></div>`);
  const div = nodes[0];
  assert.equal(div.children.length, 2);
  assert.equal(div.children[0].tag, "h1");
  assert.equal(div.children[1].tag, "p");
});

test("parses a static attribute", () => {
  const nodes = parseTemplate(`<div class="wrapper"></div>`);
  assert.deepEqual(nodes[0].attributes, [
    { type: "Attribute", name: "class", value: "wrapper", dynamic: false },
  ]);
});

test("parses a dynamic event-binding attribute using the expression parser", () => {
  const nodes = parseTemplate(`<button onclick="{{ increment }}">+1</button>`);
  const attr = nodes[0].attributes[0];
  assert.equal(attr.name, "onclick");
  assert.equal(attr.dynamic, true);
  assert.deepEqual(attr.value, { type: "Identifier", name: "increment" });
});

test("parses a self-closing element", () => {
  const nodes = parseTemplate(`<input />`);
  assert.deepEqual(nodes, [{ type: "Element", tag: "input", attributes: [], children: [] }]);
});

test("parses the realistic counter template from the design doc", () => {
  const nodes = parseTemplate(`
    <div>
      <h1>{{ title }}</h1>
      <p>Count: {{ count }}, doubled: {{ doubled }}</p>
      <button onclick="{{ increment }}">+1</button>
    </div>
  `);
  const div = nodes[0];
  assert.equal(div.tag, "div");
  assert.equal(div.children.length, 3);
  assert.equal(div.children[0].tag, "h1");
  assert.equal(div.children[1].tag, "p");
  assert.equal(div.children[2].tag, "button");
});

test("throws a clear error on a mismatched closing tag", () => {
  assert.throws(() => parseTemplate(`<div><span></div></span>`), /Mismatched closing tag/);
});

test("throws a clear error on an unclosed tag", () => {
  assert.throws(() => parseTemplate(`<div><span>text</div>`), /Unclosed tag|Mismatched closing tag/);
});

test("throws a clear error on an unterminated interpolation", () => {
  assert.throws(() => parseTemplate(`<div>{{ count </div>`), /Unterminated interpolation/);
});

test("preserves meaningful whitespace between text and interpolation", () => {
  const nodes = parseTemplate(`<h1>Hello {{ name }}</h1>`);
  assert.equal(nodes[0].type, "Element");
  const [textNode, interpNode] = nodes[0].children;
  assert.equal(textNode.type, "Text");
  assert.equal(textNode.value, "Hello ");
  assert.equal(interpNode.type, "Interpolation");
});

test("collapses indentation-only whitespace between tags to nothing", () => {
  const nodes = parseTemplate(`<div>\n  <h1>Hi</h1>\n</div>`);
  assert.equal(nodes[0].children.length, 1, "pure-whitespace indentation should not become a Text node");
  assert.equal(nodes[0].children[0].tag, "h1");
});
