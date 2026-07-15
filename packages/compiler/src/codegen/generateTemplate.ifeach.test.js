import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateTemplate } from "./generateTemplate.js";
import { parseTemplate } from "../parser/parseTemplate.js";
import { reactive, effect } from "../runtime/reactive.js";

function renderToDom(templateSource, instance) {
  const nodes = parseTemplate(templateSource);
  const { code, rootVar } = generateTemplate(nodes);
  const dom = new JSDOM();
  const { document } = dom.window;
  const fn = new Function("document", "effect", "instance", "components", `${code}\nreturn ${rootVar};`);
  const rootNode = fn(document, effect, instance, {});
  return { rootNode, document };
}

test("renders the if branch when condition is true, hides it when false", () => {
  const instance = reactive({ visible: true });
  const { rootNode } = renderToDom(`<div>{{#if visible}}<p>Shown</p>{{/if}}</div>`, instance);

  assert.equal(rootNode.querySelector("p")?.textContent, "Shown");
  instance.visible = false;
  assert.equal(rootNode.querySelector("p"), null);
  instance.visible = true;
  assert.equal(rootNode.querySelector("p")?.textContent, "Shown");
});

test("renders a list with {{#each}}, using the loop variable bare (not instance.<var>)", () => {
  const instance = reactive({ posts: [{ title: "First" }, { title: "Second" }] });
  const { rootNode } = renderToDom(
    `<ul>{{#each post in posts}}<li>{{ post.title }}</li>{{/each}}</ul>`,
    instance
  );

  const items = rootNode.querySelectorAll("li");
  assert.equal(items.length, 2);
  assert.equal(items[0].textContent, "First");
  assert.equal(items[1].textContent, "Second");
});

test("each list rebuilds correctly when the underlying array changes", () => {
  const instance = reactive({ posts: [{ title: "A" }] });
  const { rootNode } = renderToDom(
    `<ul>{{#each post in posts}}<li>{{ post.title }}</li>{{/each}}</ul>`,
    instance
  );

  assert.equal(rootNode.querySelectorAll("li").length, 1);
  instance.posts = [{ title: "X" }, { title: "Y" }, { title: "Z" }];
  const items = rootNode.querySelectorAll("li");
  assert.equal(items.length, 3);
  assert.equal(items[1].textContent, "Y");
});

test("nested if inside each correctly filters items reactively", () => {
  const instance = reactive({
    posts: [
      { title: "Visible", published: true },
      { title: "Hidden", published: false },
    ],
  });
  const { rootNode } = renderToDom(
    `<ul>{{#each post in posts}}{{#if post.published}}<li>{{ post.title }}</li>{{/if}}{{/each}}</ul>`,
    instance
  );

  const items = rootNode.querySelectorAll("li");
  assert.equal(items.length, 1);
  assert.equal(items[0].textContent, "Visible");
});

test("event binding with a CallExpression passes explicit arguments, not the DOM event", () => {
  const instance = reactive({
    posts: [{ id: 1, title: "A" }, { id: 2, title: "B" }],
  });
  const removed = [];
  instance.remove = function (id) {
    removed.push(id);
    this.posts = this.posts.filter((p) => p.id !== id);
  };

  const { rootNode, document } = renderToDom(
    `<ul>{{#each post in posts}}<li>{{ post.title }}<button onclick="{{ remove(post.id) }}">x</button></li>{{/each}}</ul>`,
    instance
  );

  const firstButton = rootNode.querySelectorAll("button")[0];
  firstButton.dispatchEvent(new document.defaultView.Event("click"));

  assert.deepEqual(removed, [1]);
  assert.equal(rootNode.querySelectorAll("li").length, 1);
  assert.equal(rootNode.querySelector("li").textContent.includes("B"), true);
});
