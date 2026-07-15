import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageFile } from "./parsePageFile.js";

test("parses the page name from the page declaration", () => {
  const result = parsePageFile(`page Home\n\ntemplate\n  <div>Hi</div>`);
  assert.equal(result.pageName, "Home");
});

test("extracts state/computed/action into the script portion", () => {
  const source = `
page Counter

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count = this.count + 1
  }

template
  <div>{{ count }}</div>
`;
  const result = parsePageFile(source);
  assert.match(result.script, /state/);
  assert.match(result.script, /computed/);
  assert.match(result.script, /action/);
  assert.match(result.script, /increment/);
  assert.doesNotMatch(result.script, /<div>/);
});

test("extracts the template section", () => {
  const source = `page Home\n\ntemplate\n  <h1>{{ title }}</h1>`;
  const result = parsePageFile(source);
  assert.match(result.template, /<h1>\{\{ title \}\}<\/h1>/);
});

test("extracts an optional style section after the template", () => {
  const source = `
page Home

template
  <p>Hi</p>

style
  p { color: red; }
`;
  const result = parsePageFile(source);
  assert.match(result.template, /<p>Hi<\/p>/);
  assert.match(result.style, /color: red/);
  assert.doesNotMatch(result.template, /color: red/);
});

test("style is optional and defaults to empty string", () => {
  const result = parsePageFile(`page Home\n\ntemplate\n  <p>Hi</p>`);
  assert.equal(result.style, "");
});

test("throws when the page declaration is missing", () => {
  assert.throws(() => parsePageFile(`template\n  <p>Hi</p>`), /must start with "page/);
});

test("throws when the template section is missing", () => {
  assert.throws(() => parsePageFile(`page Home\n\nstate\n  count: 0`), /missing a required "template"/);
});

test("parses a realistic full counter page with no wrapper tags", () => {
  const source = `
page Counter

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count = this.count + 1
  }

template
  <div>
    <h1>Counter</h1>
    <p>Count: {{ count }}, doubled: {{ doubled }}</p>
    <button onclick="{{ increment }}">+1</button>
  </div>
`;
  const result = parsePageFile(source);
  assert.equal(result.pageName, "Counter");
  assert.match(result.script, /count: 0/);
  assert.match(result.template, /<button onclick="\{\{ increment \}\}">\+1<\/button>/);
});
