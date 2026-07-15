import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderPageDocument } from "./renderPageDocument.js";

function loadDocument(html) {
  return new Promise((resolve) => {
    const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
    dom.window.document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => resolve(dom), 0);
    });
  });
}

test("renders a full HTML document from native Tylix syntax, mounted and interactive", async () => {
  const source = `
page CounterPage

state
  count: 0

action
  increment() {
    this.count = this.count + 1
  }

template
  <div>
    <span>{{ count }}</span>
    <button onclick="{{ increment }}">+1</button>
  </div>
`;

  const html = renderPageDocument(source);
  assert.match(html, /<title>CounterPage<\/title>/);

  const dom = await loadDocument(html);
  const { document } = dom.window;

  const span = document.querySelector("#app span");
  const button = document.querySelector("#app button");

  assert.equal(span.textContent, "0");
  button.dispatchEvent(new dom.window.Event("click"));
  assert.equal(span.textContent, "1");
});

test("inlines the style section into the document head", async () => {
  const source = `
page Home

template
  <p>Hello</p>

style
  p { color: red; }
`;
  const html = renderPageDocument(source);
  assert.match(html, /<style>\s*p \{ color: red; \}\s*<\/style>/);
});

test("omits the style tag entirely when no style section is present", async () => {
  const source = `page Home\n\ntemplate\n  <p>Hello</p>`;
  const html = renderPageDocument(source);
  assert.doesNotMatch(html, /<style>/);
});

test("supports a page with no script section at all", async () => {
  const source = `page Static\n\ntemplate\n  <p>Just static markup</p>`;
  const html = renderPageDocument(source);
  const dom = await loadDocument(html);
  assert.equal(dom.window.document.querySelector("#app p").textContent, "Just static markup");
});
