const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeMeetingTranscript,
  normalizeTranscriptionResult,
} = require("../../src/helpers/dictationFlowResultCore.cjs");

const dictionary = ["EntVerse", "OpenWhispr", "EnlightAI"];
const aliases = [{ from: "Antibus", to: "EntVerse" }];

test("voice flow fixtures correct realtime short dictation brand terms", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "Antibus 跟 openwhispr 都要记下来",
      text: "Antibus 跟 openwhispr 都要记下来。",
    },
    { mode: "dictation", customDictionary: dictionary, customDictionaryAliases: aliases }
  );

  assert.equal(result.displayText, "EntVerse 跟 OpenWhispr 都要记下来。");
  assert.equal(result.warning, "dictionary_corrected");
  assert.deepEqual(result.dictionaryCorrections, [
    { from: "Antibus", to: "EntVerse", kind: "alias" },
    { from: "openwhispr", to: "OpenWhispr", kind: "case" },
  ]);
  assert.deepEqual(result.processingMetadata.voiceFlow.dictionaryCorrections, result.dictionaryCorrections);
});

test("voice flow fixtures keep retry and upload on the same correction path", () => {
  for (const mode of ["retry", "upload", "meeting"]) {
    const result =
      mode === "meeting"
        ? normalizeMeetingTranscript("Antibus integrates with EnlightAI.", {
            customDictionary: dictionary,
            customDictionaryAliases: aliases,
          })
        : normalizeTranscriptionResult(
            {
              success: true,
              text: "Antibus integrates with EnlightAI.",
              source: "openai",
            },
            { mode, customDictionary: dictionary, customDictionaryAliases: aliases }
          );

    assert.equal(result.mode, mode);
    assert.equal(result.displayText, "EntVerse integrates with EnlightAI.");
    assert.equal(result.processingMetadata.voiceFlow.mode, mode);
    assert.deepEqual(result.dictionaryCorrections, [
      { from: "Antibus", to: "EntVerse", kind: "alias" },
    ]);
  }
});

test("voice flow fixtures still correct raw text when cleanup falls back", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      rawText: "Antibus",
      text: "",
      warning: "cleanup_failed",
    },
    { mode: "dictation", customDictionary: dictionary, customDictionaryAliases: aliases }
  );

  assert.equal(result.displayText, "EntVerse");
  assert.equal(result.warning, "cleanup_failed");
  assert.deepEqual(result.dictionaryCorrections, [
    { from: "Antibus", to: "EntVerse", kind: "alias" },
  ]);
});

test("voice flow fixtures do not rewrite distant or Chinese candidates", () => {
  const result = normalizeTranscriptionResult(
    {
      success: true,
      text: "安提巴斯 and unrelated universe remain unchanged.",
    },
    { mode: "dictation", customDictionary: ["EntVerse"] }
  );

  assert.equal(result.displayText, "安提巴斯 and unrelated universe remain unchanged.");
  assert.equal(result.warning, null);
  assert.equal(result.dictionaryCorrections, undefined);
  assert.deepEqual(result.processingMetadata.voiceFlow.dictionaryCorrections, []);
});
