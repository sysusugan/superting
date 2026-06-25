import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDictionaryDisplayItems,
  filterDictionaryDisplayItems,
} from "../../src/utils/dictionaryListItems.ts";

test("builds one unified list with alias rows following their dictionary target", () => {
  const items = buildDictionaryDisplayItems({
    dictionary: ["agent", "EntVerse", "Superwhisper"],
    aliases: [
      { from: "A人", to: "agent" },
      { from: "super whisper", to: "Superwhisper" },
      { from: "anders", to: "entverse" },
      { from: "orphan", to: "Missing" },
    ],
  });

  assert.deepEqual(
    items.map((item) => item.id),
    [
      "word:agent",
      "alias:A人->agent",
      "word:EntVerse",
      "alias:anders->entverse",
      "word:Superwhisper",
      "alias:super whisper->Superwhisper",
      "alias:orphan->Missing",
    ]
  );
});

test("search matches dictionary words and alias source or target text", () => {
  const items = buildDictionaryDisplayItems({
    dictionary: ["agent", "EntVerse", "Superwhisper"],
    aliases: [
      { from: "A人", to: "agent" },
      { from: "super whisper", to: "Superwhisper" },
    ],
  });

  assert.deepEqual(
    filterDictionaryDisplayItems(items, "verse").map((item) => item.id),
    ["word:EntVerse"]
  );
  assert.deepEqual(
    filterDictionaryDisplayItems(items, "a人").map((item) => item.id),
    ["alias:A人->agent"]
  );
  assert.deepEqual(
    filterDictionaryDisplayItems(items, "superwhisper").map((item) => item.id),
    ["word:Superwhisper", "alias:super whisper->Superwhisper"]
  );
});

test("search returns an empty list when no dictionary rows match", () => {
  const items = buildDictionaryDisplayItems({
    dictionary: ["agent"],
    aliases: [{ from: "A人", to: "agent" }],
  });

  assert.deepEqual(filterDictionaryDisplayItems(items, "not found"), []);
});
