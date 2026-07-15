import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { compileComponent } from "./compileComponent.js";

test("compiles and mounts a full counter component from raw .tyx source", () => {
  const source = `
<script>
state {
  count: 0
}

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

  const Component = compileComponent(source, "Counter");
  const dom = new JSDOM();
  const { node, instance } = Component.mount(dom.window.document);

  dom.window.document.body.appendChild(node);
  const span = node.querySelector("span");
  const button = node.querySelector("button");

  assert.equal(span.textContent, "0");
  assert.equal(instance.count, 0);

  button.dispatchEvent(new dom.window.Event("click"));
  assert.equal(span.textContent, "1");
  assert.equal(instance.count, 1);

  button.dispatchEvent(new dom.window.Event("click"));
  assert.equal(span.textContent, "2");
});

test("compiles a template-only component with no script section", () => {
  const source = `
<template>
<p>Static content, no reactivity needed</p>
</template>
`;

  const Component = compileComponent(source);
  const dom = new JSDOM();
  const { node } = Component.mount(dom.window.document);

  assert.equal(node.textContent, "Static content, no reactivity needed");
});

test("computed values work correctly when mounted", () => {
  const source = `
<script>
state { count: 3 }
computed {
  doubled() {
    return this.count * 2;
  }
}
action {
  increment() {
    this.count = this.count + 1;
  }
}
</script>

<template>
<div>
  <span>{{ doubled }}</span>
  <button onclick="{{ increment }}">+1</button>
</div>
</template>
`;

  const Component = compileComponent(source, "WithComputed");
  const dom = new JSDOM();
  const { node } = Component.mount(dom.window.document);

  const span = node.querySelector("span");
  const button = node.querySelector("button");

  assert.equal(span.textContent, "6");
  button.dispatchEvent(new dom.window.Event("click"));
  assert.equal(span.textContent, "8");
});

test("mounts a component that nests another compiled component", () => {
  const badgeSource = `
<template>
<span class="badge">Verified</span>
</template>
`;
  const Badge = compileComponent(badgeSource, "Badge");

  const profileSource = `
<template>
<div>
  <h1>Ada Lovelace</h1>
  <Badge />
</div>
</template>
`;
  const Profile = compileComponent(profileSource, "Profile");

  const dom = new JSDOM();
  const { node } = Profile.mount(dom.window.document, { Badge });

  const badgeSpan = node.querySelector(".badge");
  assert.equal(badgeSpan.textContent, "Verified");
  assert.equal(node.querySelector("h1").textContent, "Ada Lovelace");
});
