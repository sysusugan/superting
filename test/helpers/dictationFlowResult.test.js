const { before, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeTranscriptionResult,
  normalizeMeetingSegment,
  normalizeMeetingTranscript,
} = require("../../src/helpers/dictationFlowResultCore.cjs");

let normalizeDictationResult;
let resolveStreamingDictationText;
let settleStreamingStop;
let pickDictationWarning;

before(async () => {
  ({
    normalizeDictationResult,
    resolveStreamingDictationText,
    settleStreamingStop,
    pickDictationWarning,
  } = await import("../../src/helpers/dictationFlowResult.js"));
});

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
      cleanupError: {
        message: "OpenAI API key is missing",
        code: "API_KEY_MISSING",
        provider: "openai",
        model: "gpt-5-mini",
        stage: "cleanup",
        stack: "do not persist",
      },
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
  assert.deepEqual(result.processingMetadata.voiceFlow.cleanupError, {
    message: "OpenAI API key is missing",
    code: "API_KEY_MISSING",
    provider: "openai",
    model: "gpt-5-mini",
    stage: "cleanup",
  });
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

test("settles streaming stop with provider result before timeout", async () => {
  const result = await settleStreamingStop(() => Promise.resolve({ success: true, text: "done" }), {
    timeoutMs: 20,
  });

  assert.deepEqual(result, {
    success: true,
    text: "done",
    warning: null,
    timedOut: false,
  });
});

test("settles streaming stop with timeout warning", async () => {
  const result = await settleStreamingStop(
    () => new Promise((resolve) => setTimeout(() => resolve({ success: true, text: "late" }), 30)),
    { timeoutMs: 1 }
  );

  assert.deepEqual(result, {
    success: false,
    text: "",
    warning: "streaming_stop_timeout",
    timedOut: true,
  });
});

test("settles streaming stop with failure warning", async () => {
  const result = await settleStreamingStop(() => Promise.reject(new Error("socket closed")), {
    timeoutMs: 20,
  });

  assert.deepEqual(result, {
    success: false,
    text: "",
    error: "socket closed",
    warning: "streaming_stop_failed",
    timedOut: false,
  });
});

test("keeps the most user-visible dictation warning", () => {
  assert.equal(pickDictationWarning("partial_result", "streaming_stop_timeout"), "partial_result");
  assert.equal(pickDictationWarning(null, "streaming_stop_timeout"), "streaming_stop_timeout");
  assert.equal(pickDictationWarning("cleanup_failed", "partial_result"), "cleanup_failed");
  assert.equal(
    pickDictationWarning(null, "dictionary_prompt_truncated"),
    "dictionary_prompt_truncated"
  );
  assert.equal(
    pickDictationWarning("dictionary_prompt_truncated", "cleanup_failed"),
    "cleanup_failed"
  );
});

test("normalizes upload transcription results with raw display metadata", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      text: "Uploaded transcript",
      provider: "openwhispr",
      model: "cloud",
      partial: true,
      chunksTotal: 3,
      chunksSucceeded: 2,
      chunksFailed: 1,
      warning: "upload_partial",
    },
    {
      mode: "upload",
      language: "en",
      timings: { transcriptionProcessingDurationMs: 1200 },
    }
  );

  assert.equal(result.mode, "upload");
  assert.equal(result.stage, "complete");
  assert.equal(result.rawText, "Uploaded transcript");
  assert.equal(result.refinedText, "");
  assert.equal(result.displayText, "Uploaded transcript");
  assert.equal(result.text, "Uploaded transcript");
  assert.equal(result.provider, "openwhispr");
  assert.equal(result.model, "cloud");
  assert.equal(result.language, "en");
  assert.equal(result.partial, true);
  assert.equal(result.warning, "upload_partial");
  assert.equal(result.chunksTotal, 3);
  assert.equal(result.chunksSucceeded, 2);
  assert.equal(result.chunksFailed, 1);
  assert.deepEqual(result.timings, { transcriptionProcessingDurationMs: 1200 });
});

test("normalizes retry results with refined text fallback semantics", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "raw retry text",
      text: "Clean retry text",
      source: "groq",
      model: "whisper-large-v3",
    },
    { mode: "retry", audioDurationMs: 4567 }
  );

  assert.equal(result.mode, "retry");
  assert.equal(result.rawText, "raw retry text");
  assert.equal(result.refinedText, "Clean retry text");
  assert.equal(result.displayText, "Clean retry text");
  assert.equal(result.provider, "groq");
  assert.equal(result.model, "whisper-large-v3");
  assert.equal(result.audioDurationMs, 4567);
});

test("normalizes transcription results after dictionary correction", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "Antibus 跟 EnlightAI 是配合的关系",
      text: "Antibus 跟 EnlightAI 是配合的关系。",
      source: "openai",
    },
    {
      mode: "dictation",
      customDictionary: ["EntVerse", "EnlightAI"],
      customDictionaryAliases: [{ from: "Antibus", to: "EntVerse" }],
    }
  );

  assert.equal(result.rawText, "EntVerse 跟 EnlightAI 是配合的关系");
  assert.equal(result.displayText, "EntVerse 跟 EnlightAI 是配合的关系。");
  assert.equal(result.text, "EntVerse 跟 EnlightAI 是配合的关系。");
  assert.equal(result.warning, "dictionary_corrected");
  assert.deepEqual(result.dictionaryCorrections, [
    { from: "Antibus", to: "EntVerse", kind: "alias" },
  ]);
});

test("normalizes final dictation display text to the preferred Chinese script", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "是說由這個 Agent 去理解了企業的各種",
      text: "是說由這個 Agent 去理解了企業的各種",
      source: "openai",
    },
    { mode: "dictation", language: "zh-CN" }
  );

  assert.equal(result.rawText, "是說由這個 Agent 去理解了企業的各種");
  assert.equal(result.displayText, "是说由这个 Agent 去理解了企业的各种");
  assert.equal(result.text, "是说由这个 Agent 去理解了企业的各种");
});

test("uses normalizationLanguage when STT language is a base Chinese code", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "是說由這個 Agent 去理解了企業的各種",
      text: "是說由這個 Agent 去理解了企業的各種",
      source: "openai",
    },
    { mode: "dictation", language: "zh", normalizationLanguage: "zh-CN" }
  );

  assert.equal(result.language, "zh");
  assert.equal(result.rawText, "是說由這個 Agent 去理解了企業的各種");
  assert.equal(result.displayText, "是说由这个 Agent 去理解了企业的各种");
});

test("normalizes final dictation display text to Simplified Chinese without overwriting raw text", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "是說由這個 Agent 去理解了企業的各種",
      text: "是說由這個 Agent 去理解了企業的各種。",
      source: "openai",
    },
    { mode: "dictation", language: "zh-CN" }
  );

  assert.equal(result.rawText, "是說由這個 Agent 去理解了企業的各種");
  assert.equal(result.displayText, "是说由这个 Agent 去理解了企业的各种。");
  assert.equal(result.text, "是说由这个 Agent 去理解了企业的各种。");
  assert.equal(result.processingMetadata.voiceFlow.rawText, result.rawText);
  assert.equal(result.processingMetadata.voiceFlow.displayText, result.displayText);
});

test("normalizes meeting transcription segments without treating partials as errors", () => {
  const partial = normalizeMeetingSegment(
    { text: "hello", source: "mic", type: "partial", timestamp: 123 },
    { provider: "deepgram-realtime", model: "nova-3", language: "en" }
  );

  assert.equal(partial.mode, "meeting");
  assert.equal(partial.stage, "partial");
  assert.equal(partial.rawText, "hello");
  assert.equal(partial.displayText, "hello");
  assert.equal(partial.partial, true);
  assert.equal(partial.warning, null);
  assert.equal(partial.provider, "deepgram-realtime");
  assert.equal(partial.model, "nova-3");
  assert.equal(partial.language, "en");

  const retracted = normalizeMeetingSegment({ text: "stale", source: "mic", type: "retract" });
  assert.equal(retracted.stage, "retract");
  assert.equal(retracted.partial, false);
});

test("normalizes meeting final segments to Simplified Chinese after dictionary corrections", () => {
  const final = normalizeMeetingSegment(
    { text: "Antibus 是說由這個 Agent 去理解了企業的各種", source: "system", type: "final" },
    {
      language: "zh-CN",
      customDictionary: ["EntVerse"],
      customDictionaryAliases: [{ from: "Antibus", to: "EntVerse" }],
    }
  );

  assert.equal(final.rawText, "Antibus 是說由這個 Agent 去理解了企業的各種");
  assert.equal(final.text, "EntVerse 是说由这个 Agent 去理解了企业的各种");
  assert.equal(final.displayText, "EntVerse 是说由这个 Agent 去理解了企业的各种");
  assert.equal(final.warning, "dictionary_corrected");
});

test("normalizes meeting final segments with dictionary corrections", () => {
  const final = normalizeMeetingSegment(
    { text: "Antibus uses openwhispr.", source: "system", type: "final", timestamp: 456 },
    {
      provider: "openai-realtime",
      model: "gpt-4o-mini-transcribe",
      customDictionary: ["EntVerse", "OpenWhispr"],
      customDictionaryAliases: [{ from: "Antibus", to: "EntVerse" }],
    }
  );

  assert.equal(final.rawText, "Antibus uses openwhispr.");
  assert.equal(final.text, "EntVerse uses OpenWhispr.");
  assert.equal(final.displayText, "EntVerse uses OpenWhispr.");
  assert.equal(final.warning, "dictionary_corrected");
  assert.deepEqual(final.dictionaryCorrections, [
    { from: "Antibus", to: "EntVerse", kind: "alias" },
    { from: "openwhispr", to: "OpenWhispr", kind: "case" },
  ]);
});

test("normalizes meeting final segments to the preferred Chinese script", () => {
  const final = normalizeMeetingSegment(
    {
      text: "是說由這個 Agent 去理解了企業的各種",
      source: "system",
      type: "final",
      timestamp: 456,
    },
    { language: "zh-CN" }
  );

  assert.equal(final.rawText, "是說由這個 Agent 去理解了企業的各種");
  assert.equal(final.text, "是说由这个 Agent 去理解了企业的各种");
  assert.equal(final.displayText, "是说由这个 Agent 去理解了企业的各种");
});

test("does not rewrite meeting partial segments", () => {
  const partial = normalizeMeetingSegment(
    { text: "Antibus openwhispr", source: "system", type: "partial", timestamp: 789 },
    {
      customDictionary: ["EntVerse", "OpenWhispr"],
      customDictionaryAliases: [{ from: "Antibus", to: "EntVerse" }],
    }
  );

  assert.equal(partial.text, "Antibus openwhispr");
  assert.equal(partial.displayText, "Antibus openwhispr");
  assert.equal(partial.warning, null);
  assert.equal(partial.dictionaryCorrections, undefined);
});

test("normalizes full meeting transcripts with voice flow metadata", () => {
  const result = normalizeMeetingTranscript("Antibus discusses openwhispr.", {
    provider: "openai-realtime",
    model: "gpt-4o-mini-transcribe",
    customDictionary: ["EntVerse", "OpenWhispr"],
    customDictionaryAliases: [{ from: "Antibus", to: "EntVerse" }],
  });

  assert.equal(result.mode, "meeting");
  assert.equal(result.rawText, "EntVerse discusses OpenWhispr.");
  assert.equal(result.displayText, "EntVerse discusses OpenWhispr.");
  assert.equal(result.warning, "dictionary_corrected");
  assert.deepEqual(result.processingMetadata.voiceFlow.dictionaryCorrections, [
    { from: "Antibus", to: "EntVerse", kind: "alias" },
    { from: "openwhispr", to: "OpenWhispr", kind: "case" },
  ]);
});

test("normalizes full meeting transcripts to Simplified Chinese for summary input", () => {
  const result = normalizeMeetingTranscript("是說由這個 Agent 去理解了企業的各種", {
    language: "zh-CN",
  });

  assert.equal(result.rawText, "是說由這個 Agent 去理解了企業的各種");
  assert.equal(result.displayText, "是说由这个 Agent 去理解了企业的各种");
  assert.equal(result.text, "是说由这个 Agent 去理解了企业的各种");
  assert.equal(result.processingMetadata.voiceFlow.displayText, result.displayText);
});

test("normalizes full meeting transcripts before summaries consume display text", () => {
  const result = normalizeMeetingTranscript("他说由这个 Agent 去理解了企业的各种", {
    language: "zh-TW",
  });

  assert.equal(result.rawText, "他说由这个 Agent 去理解了企业的各种");
  assert.equal(result.displayText, "他說由這個 Agent 去理解了企業的各種");
  assert.equal(result.text, "他說由這個 Agent 去理解了企業的各種");
  assert.equal(result.processingMetadata.voiceFlow.displayText, "他說由這個 Agent 去理解了企業的各種");
});

test("uses scriptLanguage for Chinese script normalization when STT language is base zh", () => {
  const result = normalizeMeetingTranscript("是說由這個 Agent 去理解了企業的各種", {
    language: "zh",
    scriptLanguage: "zh-CN",
  });

  assert.equal(result.language, "zh");
  assert.equal(result.scriptLanguage, "zh-CN");
  assert.equal(result.displayText, "是说由这个 Agent 去理解了企业的各种");
});
