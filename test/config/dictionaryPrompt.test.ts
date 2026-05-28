import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDictionaryInstruction,
  buildDictionaryPrompt,
  normalizeDictionaryWords,
} from "../../src/config/dictionaryPrompt.js";

test("normalizes dictionary words before building prompts", () => {
  assert.deepEqual(normalizeDictionaryWords([" Universe ", "", "Navy", "Universe"]), [
    "Universe",
    "Navy",
  ]);
});

test("builds a short ASR dictionary prompt", () => {
  assert.equal(buildDictionaryPrompt(["Universe", "Navy"]), "Universe, Navy");
});

test("builds a strong LLM dictionary instruction", () => {
  const instruction = buildDictionaryInstruction(["Universe", "Navy"]);

  assert.match(instruction, /ASR/i);
  assert.match(instruction, /do not translate/i);
  assert.match(instruction, /Universe, Navy/);
});

test("returns empty dictionary instruction for empty words", () => {
  assert.equal(buildDictionaryInstruction([]), "");
  assert.equal(buildDictionaryPrompt([]), null);
});
