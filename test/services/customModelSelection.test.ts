import assert from "node:assert/strict";
import test from "node:test";

import { selectCustomModel } from "../../src/services/ai/customModelSelection.ts";

const models = [{ value: "deepseek-chat" }, { value: "deepseek-reasoner" }];

test("keeps a selected custom model when it is still available", () => {
  assert.equal(selectCustomModel("deepseek-reasoner", models), "deepseek-reasoner");
});

test("selects the first available model when the current model is empty", () => {
  assert.equal(selectCustomModel("", models), "deepseek-chat");
});

test("replaces a model that is no longer advertised by the endpoint", () => {
  assert.equal(selectCustomModel("removed-model", models), "deepseek-chat");
});

test("returns empty when the endpoint has no models", () => {
  assert.equal(selectCustomModel("", []), "");
});
