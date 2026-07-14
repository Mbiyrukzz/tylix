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

  const fn = new Function(
    "document",
    "effect",
    "instance",
    `${code}\nreturn ${rootVar};`
  );

  const rootNode = fn(document, effect, instance);
  return { rootNode, document };
}

test("compiles static text into a real text node", () => {
  const { rootNode } = renderToDom(`<p>Hello Tylix</p>`, {});
  assert.equal(rootNode.tagName, "P");
  assert.equal(rootNode.textContent, "Hello Tylix");
});

test("compiles an interpolation into a live-updating text node", () => {
  const instance = reactive({ count: 0 });
  const { rootNode } = renderToDom(`<span>{{ count }}</span>`, instance);

  assert.equal(rootNode.textContent, "0");
  instance.count = 5;
  assert.equal(rootNode.textContent, "5");
});

test("compiles nested elements with mixed text and interpolation", () => {
  const instance = reactive({ name: "Ada" });
  const { rootNode } = renderToDom(`<div><h1>Hello {{ name }}</h1></div>`, instance);

  const h1 = rootNode.querySelector("h1");
  assert.equal(h1.textContent, "Hello Ada");
  instance.name = "Grace";
  assert.equal(h1.textContent, "Hello Grace");
});

test("compiles a static attribute", () => {
  const { rootNode } = renderToDom(`<div class="box"></div>`, {});
  assert.equal(rootNode.getAttribute("class"), "box");
});

test("compiles a dynamic attribute that updates reactively", () => {
  const instance = reactive({ theme: "dark" });
  const { rootNode } = renderToDom(`<div class="{{ theme }}"></div>`, instance);

  assert.equal(rootNode.getAttribute("class"), "dark");
  instance.theme = "light";
  assert.equal(rootNode.getAttribute("class"), "light");
});

test("compiles an event binding that calls the bound instance method", () => {
  let clicked = false;
  const instance = { handleClick: () => { clicked = true; } };
  const { rootNode, document } = renderToDom(`<button onclick="{{ handleClick }}">Go</button>`, instance);

  document.body.appendChild(rootNode);
  rootNode.dispatchEvent(new document.defaultView.Event("click"));

  assert.equal(clicked, true);
});

test("compiles the full realistic counter template with a live click handler", () => {
  const instance = reactive({ count: 0 });
  instance.increment = function () {
    this.count = this.count + 1;
  };

  const { rootNode, document } = renderToDom(
    `<div><span>{{ count }}</span><button onclick="{{ increment }}">+1</button></div>`,
    instance
  );

  document.body.appendChild(rootNode);
  const span = rootNode.querySelector("span");
  const button = rootNode.querySelector("button");

  assert.equal(span.textContent, "0");
  button.dispatchEvent(new document.defaultView.Event("click"));
  assert.equal(span.textContent, "1");
  button.dispatchEvent(new document.defaultView.Event("click"));
  assert.equal(span.textContent, "2");
});

test("throws a clear error for a non-{{}} event attribute", () => {
  assert.throws(
    () => generateTemplate(parseTemplate(`<button onclick="doStuff">Go</button>`)),
    /must use \{\{ \}\} binding/
  );
});
