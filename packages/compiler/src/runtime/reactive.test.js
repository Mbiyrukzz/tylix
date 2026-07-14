import { test } from "node:test";
import assert from "node:assert/strict";
import { reactive, effect } from "./reactive.js";

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
