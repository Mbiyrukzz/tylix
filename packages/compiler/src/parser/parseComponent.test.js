import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "./parseComponent.js";

test("extracts script, template, and style sections", () => {
  const source = `
<script>
state { count: 0 }
</script>

<template>
<div>{{ count }}</div>
</template>

<style>
div { color: red; }
</style>
`;

  const result = parseComponent(source);
  assert.match(result.script, /state \{ count: 0 \}/);
  assert.match(result.template, /<div>\{\{ count \}\}<\/div>/);
  assert.match(result.style, /div \{ color: red; \}/);
});

test("style is optional and defaults to empty string", () => {
  const source = `
<script>
state { count: 0 }
</script>

<template>
<div>Hello</div>
</template>
`;
  const result = parseComponent(source);
  assert.equal(result.style, "");
});

test("script is optional and defaults to empty string", () => {
  const source = `
<template>
<div>Static content</div>
</template>
`;
  const result = parseComponent(source);
  assert.equal(result.script, "");
});

test("throws when <template> is missing", () => {
  const source = `<script>state { x: 1 }</script>`;
  assert.throws(() => parseComponent(source), /missing a required <template>/);
});
