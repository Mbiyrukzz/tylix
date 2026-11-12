import { test } from "node:test";
import assert from "node:assert/strict";
import { reactive, effect, untracked, toRaw } from "./reactive.js";

test("reading a reactive property inside an effect tracks it", () => {
  const state = reactive({ count: 0 });
  let seen = null;

  effect(() => {
    seen = state.count;
  });

  assert.equal(seen, 0);
});

test("writing a tracked property re-runs the effect", () => {
  const state = reactive({ count: 0 });
  let runs = 0;

  effect(() => {
    state.count; // read to establish dependency
    runs++;
  });

  assert.equal(runs, 1);
  state.count = 1;
  assert.equal(runs, 2);
  state.count = 2;
  assert.equal(runs, 3);
});

test("writing an untracked property does not re-run unrelated effects", () => {
  const state = reactive({ count: 0, other: "x" });
  let runs = 0;

  effect(() => {
    state.count;
    runs++;
  });

  state.other = "y";
  assert.equal(runs, 1, "effect should not re-run for a property it never read");
});

test("setting a property to the same value does not re-trigger", () => {
  const state = reactive({ count: 5 });
  let runs = 0;

  effect(() => {
    state.count;
    runs++;
  });

  state.count = 5;
  assert.equal(runs, 1);
});

test("multiple independent effects each track their own dependencies", () => {
  const state = reactive({ a: 1, b: 2 });
  let aRuns = 0;
  let bRuns = 0;

  effect(() => {
    state.a;
    aRuns++;
  });
  effect(() => {
    state.b;
    bRuns++;
  });

  state.a = 10;
  assert.equal(aRuns, 2);
  assert.equal(bRuns, 1);

  state.b = 20;
  assert.equal(aRuns, 2);
  assert.equal(bRuns, 2);
});

test("an effect reading multiple properties re-runs when any of them change", () => {
  const state = reactive({ first: "Ada", last: "Lovelace" });
  const fullNames = [];

  effect(() => {
    fullNames.push(`${state.first} ${state.last}`);
  });

  state.first = "Grace";
  state.last = "Hopper";

  assert.deepEqual(fullNames, ["Ada Lovelace", "Grace Lovelace", "Grace Hopper"]);
});

test("computed-style derived effect updates when its source changes", () => {
  const state = reactive({ count: 3 });
  let doubled = null;

  effect(() => {
    doubled = state.count * 2;
  });

  assert.equal(doubled, 6);
  state.count = 10;
  assert.equal(doubled, 20);
});

test("array push re-runs an effect that reads length", () => {
  const state = reactive({ list: [1] });
  let len = null;

  effect(() => {
    len = state.list.length;
  });

  state.list.push(2);
  assert.equal(len, 2);
});

test("untracked reads do not subscribe the running effect", () => {
  const state = reactive({ a: 1, b: 2 });
  let runs = 0;

  effect(() => {
    state.a;
    untracked(() => state.b);
    runs++;
  });

  state.b = 3;
  assert.equal(runs, 1);
  state.a = 2;
  assert.equal(runs, 2);
});

test("toRaw returns the original object behind a proxy", () => {
  const original = { id: 1 };
  assert.equal(toRaw(reactive(original)), original);
  assert.equal(toRaw(5), 5);
});

test("map: set re-runs effects that read that key only", () => {
  const state = reactive({ m: new Map() });
  let seen;
  let runs = 0;

  effect(() => {
    seen = state.m.get("a");
    runs++;
  });

  assert.equal(seen, undefined);
  state.m.set("a", 1);
  assert.equal(seen, 1);
  assert.equal(runs, 2);

  state.m.set("b", 2);
  assert.equal(runs, 2);
});

test("map: size and iteration update on add, change and delete", () => {
  const state = reactive({ m: new Map([["a", 1]]) });
  let size = null;
  let total = null;

  effect(() => {
    size = state.m.size;
  });
  effect(() => {
    total = 0;
    for (const [, v] of state.m) total += v;
  });

  assert.equal(size, 1);
  assert.equal(total, 1);

  state.m.set("b", 2);
  assert.equal(size, 2);
  assert.equal(total, 3);

  state.m.set("a", 10);
  assert.equal(total, 12);

  state.m.delete("a");
  assert.equal(size, 1);
  assert.equal(total, 2);

  state.m.clear();
  assert.equal(size, 0);
  assert.equal(total, 0);
});

test("map: a proxied object key finds the entry stored under the original", () => {
  const key = { id: 1 };
  const state = reactive({ m: new Map() });
  state.m.set(key, "x");
  assert.equal(state.m.get(reactive(key)), "x");
});

test("set: add and delete re-run readers, duplicates do not", () => {
  const state = reactive({ tags: new Set() });
  let has = null;
  let runs = 0;

  effect(() => {
    has = state.tags.has("a");
    runs++;
  });

  assert.equal(has, false);
  state.tags.add("a");
  assert.equal(has, true);
  assert.equal(runs, 2);

  state.tags.add("a");
  assert.equal(runs, 2);

  state.tags.delete("a");
  assert.equal(has, false);
});

test("set: spreading re-runs when members change", () => {
  const state = reactive({ tags: new Set(["x"]) });
  let list = null;

  effect(() => {
    list = [...state.tags];
  });

  assert.deepEqual(list, ["x"]);
  state.tags.add("y");
  assert.deepEqual(list, ["x", "y"]);
});

test("date: setters re-run readers, and no-op setters do not", () => {
  const state = reactive({ d: new Date(2026, 0, 1) });
  let day = null;
  let runs = 0;

  effect(() => {
    day = state.d.getDate();
    runs++;
  });

  assert.equal(day, 1);
  state.d.setDate(15);
  assert.equal(day, 15);
  assert.equal(runs, 2);

  state.d.setDate(15);
  assert.equal(runs, 2);
});

test("date: toLocaleDateString works through the proxy and tracks", () => {
  const state = reactive({ d: new Date(2026, 0, 1) });
  let text = null;

  effect(() => {
    text = state.d.toLocaleDateString("en-US");
  });

  assert.equal(typeof text, "string");
  state.d.setFullYear(2030);
  assert.ok(text.includes("2030"));
});

test("date: replacing the whole Date re-runs readers", () => {
  const state = reactive({ d: new Date(2026, 0, 1) });
  let year = null;

  effect(() => {
    year = state.d.getFullYear();
  });

  state.d = new Date(2031, 5, 5);
  assert.equal(year, 2031);
});