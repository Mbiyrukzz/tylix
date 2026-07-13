import { test } from "node:test";
import assert from "node:assert/strict";
import { pluralize } from "./pluralize.js";

test("regular words", () => assert.equal(pluralize("customer"), "customers"));
test("words ending in y", () => assert.equal(pluralize("category"), "categories"));
test("words ending in s/x/ch", () => assert.equal(pluralize("box"), "boxes"));
test("irregulars", () => assert.equal(pluralize("person"), "people"));
