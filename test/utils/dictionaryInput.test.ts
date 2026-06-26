import assert from "node:assert/strict";
import test from "node:test";

import { resolveDictionaryInputSubmission } from "../../src/utils/dictionaryInput.ts";

test("adds dictionary words when the correction field is empty", () => {
  const submission = resolveDictionaryInputSubmission({
    source: " arber, SuperTing , gRPC ",
    correction: "",
    dictionary: ["SuperTing"],
    aliases: [],
  });

  assert.deepEqual(submission, {
    type: "words",
    words: ["arber", "gRPC"],
  });
});

test("adds a correction when the correction field is filled", () => {
  const submission = resolveDictionaryInputSubmission({
    source: " Antibus, Inc. ",
    correction: " EntVerse ",
    dictionary: ["arber"],
    aliases: [],
  });

  assert.deepEqual(submission, {
    type: "alias",
    alias: { from: "Antibus, Inc.", to: "EntVerse" },
    shouldAddTargetWord: true,
  });
});

test("skips duplicate correction aliases by wrong text", () => {
  const submission = resolveDictionaryInputSubmission({
    source: "antibus",
    correction: "EntVerse",
    dictionary: ["EntVerse"],
    aliases: [{ from: "Antibus", to: "EntVerse" }],
  });

  assert.deepEqual(submission, {
    type: "alias",
    alias: null,
    shouldAddTargetWord: false,
  });
});

test("ignores empty source and same source/correction submissions", () => {
  assert.deepEqual(
    resolveDictionaryInputSubmission({
      source: "  ",
      correction: "",
      dictionary: [],
      aliases: [],
    }),
    { type: "none" }
  );

  assert.deepEqual(
    resolveDictionaryInputSubmission({
      source: "arber",
      correction: " Arber ",
      dictionary: [],
      aliases: [],
    }),
    { type: "none" }
  );
});
