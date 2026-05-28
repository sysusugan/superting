import assert from "node:assert/strict";
import test from "node:test";

import { buildNoteActionSystemPrompt } from "../../src/stores/noteActionPrompt.ts";

test("ordinary note actions include dictionary instructions", () => {
  const prompt = buildNoteActionSystemPrompt("Clean this note.", {
    isMeetingNote: false,
    customDictionary: ["Universe"],
    uiLanguage: "en",
  });

  assert.match(prompt, /note enhancement assistant/i);
  assert.match(prompt, /Universe/);
  assert.match(prompt, /ASR/i);
});

test("meeting note actions include dictionary instructions", () => {
  const prompt = buildNoteActionSystemPrompt("Generate meeting notes.", {
    isMeetingNote: true,
    customDictionary: ["Navy"],
    uiLanguage: "en",
  });

  assert.match(prompt, /professional meeting notes assistant/i);
  assert.match(prompt, /Navy/);
});
