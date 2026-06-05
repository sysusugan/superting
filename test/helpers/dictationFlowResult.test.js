const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDictationResult,
  resolveStreamingDictationText,
} = require("../../src/helpers/dictationFlowResult");

test("normalizes a successful dictation result with raw and refined text", () => {
  const result = normalizeDictationResult(
    {
      success: true,
      text: "OpenWhispr fixed Qdrant.",
      rawText: "open whisper fixed q drant",
      source: "openwhispr",
      timings: {
        transcriptionProcessingDurationMs: 320,
        reasoningProcessingDurationMs: 180,
      },
      clientTranscriptionId: "client-1",
    },
    {
      provider: "openwhispr",
      model: "gpt-4o-mini-transcribe",
      language: "en",
      durationSeconds: 1.234,
    }
  );

  assert.equal(result.mode, "dictation");
  assert.equal(result.stage, "complete");
  assert.equal(result.rawText, "open whisper fixed q drant");
  assert.equal(result.refinedText, "OpenWhispr fixed Qdrant.");
  assert.equal(result.displayText, "OpenWhispr fixed Qdrant.");
  assert.equal(result.text, "OpenWhispr fixed Qdrant.");
  assert.equal(result.provider, "openwhispr");
  assert.equal(result.model, "gpt-4o-mini-transcribe");
  assert.equal(result.language, "en");
  assert.equal(result.audioDurationMs, 1234);
  assert.equal(result.partial, false);
  assert.equal(result.warning, null);
  assert.equal(result.clientTranscriptionId, "client-1");
  assert.deepEqual(result.timings, {
    transcriptionProcessingDurationMs: 320,
    reasoningProcessingDurationMs: 180,
  });
});

test("marks cleanup fallback when refined text is missing but raw text exists", () => {
  const result = normalizeDictationResult(
    {
      success: true,
      text: "",
      rawText: "raw brand term",
      source: "local",
      warning: "cleanup_failed",
    },
    {
      provider: "whisper",
      model: "base",
      durationMs: 900,
    }
  );

  assert.equal(result.rawText, "raw brand term");
  assert.equal(result.refinedText, "");
  assert.equal(result.displayText, "raw brand term");
  assert.equal(result.text, "raw brand term");
  assert.equal(result.provider, "whisper");
  assert.equal(result.model, "base");
  assert.equal(result.audioDurationMs, 900);
  assert.equal(result.warning, "cleanup_failed");
});

test("prefers committed streaming final text over stop and partial fallbacks", () => {
  const result = resolveStreamingDictationText({
    finalText: "committed final",
    stopText: "disconnect final",
    partialText: "partial text",
  });

  assert.deepEqual(result, {
    text: "committed final",
    rawText: "committed final",
    partial: false,
    warning: null,
    source: "final",
  });
});

test("uses disconnect text before partial fallback", () => {
  const result = resolveStreamingDictationText({
    finalText: "",
    stopText: "disconnect final",
    partialText: "partial text",
  });

  assert.deepEqual(result, {
    text: "disconnect final",
    rawText: "disconnect final",
    partial: false,
    warning: null,
    source: "disconnect",
  });
});

test("marks streaming partial fallback as partial result", () => {
  const result = resolveStreamingDictationText({
    finalText: "",
    stopText: "",
    partialText: "partial text",
  });

  assert.deepEqual(result, {
    text: "partial text",
    rawText: "partial text",
    partial: true,
    warning: "partial_result",
    source: "partial",
  });
});
