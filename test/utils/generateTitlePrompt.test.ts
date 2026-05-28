import assert from "node:assert/strict";
import test from "node:test";

import { buildTitleSystemPrompt } from "../../src/utils/generateTitlePrompt.ts";

test("title generation prompt includes dictionary instructions", () => {
  const prompt = buildTitleSystemPrompt(["Universe", "Navy"]);

  assert.match(prompt, /3-8 word title/);
  assert.match(prompt, /Universe, Navy/);
  assert.match(prompt, /do not translate/i);
});
