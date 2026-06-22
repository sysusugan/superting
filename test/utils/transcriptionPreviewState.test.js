const test = require("node:test");
const assert = require("node:assert/strict");

test("maps cleanup failure results to fallback preview status", async () => {
  const { getPreviewPhaseForResult, getPreviewStatusKey } = await import(
    "../../src/utils/transcriptionPreviewState.js"
  );

  const phase = getPreviewPhaseForResult({ warning: "cleanup_failed" });

  assert.equal(phase, "fallback");
  assert.equal(getPreviewStatusKey(phase), "transcriptionPreview.usingOriginal");
});

test("maps successful results to final preview status", async () => {
  const { getPreviewPhaseForResult, getPreviewStatusKey } = await import(
    "../../src/utils/transcriptionPreviewState.js"
  );

  const phase = getPreviewPhaseForResult({ warning: null });

  assert.equal(phase, "final");
  assert.equal(getPreviewStatusKey(phase), "transcriptionPreview.ready");
});

test("final and fallback preview states display the final pasted text", async () => {
  const { getPreviewDisplayText } = await import("../../src/utils/transcriptionPreviewState.js");

  assert.equal(
    getPreviewDisplayText("final", "wrong live transcript", "accurate pasted transcript"),
    "accurate pasted transcript"
  );
  assert.equal(
    getPreviewDisplayText("fallback", "wrong live transcript", "accurate original transcript"),
    "accurate original transcript"
  );
  assert.equal(getPreviewDisplayText("live", "streaming text", "final text"), "streaming text");
});
