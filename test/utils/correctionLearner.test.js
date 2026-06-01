const test = require("node:test");
const assert = require("node:assert/strict");

const { extractReplacementCorrection } = require("../../src/utils/correctionLearner.js");

test("extractReplacementCorrection learns a valid replacement word", () => {
  assert.deepEqual(
    extractReplacementCorrection({
      findText: "Open Whisper",
      replacementText: "OpenWhispr",
      replacementCount: 1,
      existingDictionary: [],
    }),
    ["OpenWhispr"]
  );
});

test("extractReplacementCorrection skips invalid replacement candidates", () => {
  const cases = [
    { findText: "", replacementText: "OpenWhispr", replacementCount: 1 },
    { findText: "OpenWhispr", replacementText: "", replacementCount: 1 },
    { findText: "OpenWhispr", replacementText: "OpenWhispr", replacementCount: 1 },
    { findText: "AI", replacementText: "ML", replacementCount: 1 },
    { findText: "alpha", replacementText: "CompletelyDifferent", replacementCount: 1 },
    { findText: "Open Whisper", replacementText: "OpenWhispr", replacementCount: 0 },
  ];

  for (const input of cases) {
    assert.deepEqual(extractReplacementCorrection({ ...input, existingDictionary: [] }), []);
  }
});

test("extractReplacementCorrection skips existing dictionary entries case-insensitively", () => {
  assert.deepEqual(
    extractReplacementCorrection({
      findText: "Open Whisper",
      replacementText: "OpenWhispr",
      replacementCount: 3,
      existingDictionary: ["openwhispr"],
    }),
    []
  );
});
