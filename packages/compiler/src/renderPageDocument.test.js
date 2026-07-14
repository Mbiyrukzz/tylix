import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderPageDocument } from "./renderPageDocument.js";

function loadDocument(html) {
  return new Promise((resolve) => {
    const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
    dom.window.document.addEventListener("DOMContentLoaded", () => {
      // Give the app's own DOMContentLoaded listener a tick to run first.
      setTimeout(() => resolve(dom), 0);
    });
  });
}

test("renders a full HTML document with the app mounted and interactive", async () => {
  const source = `
<script>
state { count: 0 }
action {
  increment() {
    this.count = this.count + 1;
  }
}
</script>
<template>
<div>
  <span>{{ count }}</span>
  <button onclick="{{ increment }}">+1</button>
</div>
</template>
`;

  const html = renderPageDocument(source, { title: "Counter Page", className: "CounterPage" });
  assert.match(html, /<title>Counter Page<\/title>/);

  const dom = await loadDocument(html);
  const { document } = dom.window;

  const span = document.querySelector("#app span");
  const button = document.querySelector("#app button");

  assert.equal(span.textContent, "0");
  button.dispatchEvent(new dom.window.Event("click"));
  assert.equal(span.textContent, "1");
});

test("inlines <style> content into the document head", async () => {
  const source = `
<template>
<p>Hello</p>
</template>
<style>
p { color: red; }
</style>
`;
  const html = renderPageDocument(source);
  assert.match(html, /<style>\s*p \{ color: red; \}\s*<\/style>/);
});

test("omits the style tag entirely when no style section is present", async () => {
  const source = `<template><p>Hello</p></template>`;
  const html = renderPageDocument(source);
  assert.doesNotMatch(html, /<style>/);
});
