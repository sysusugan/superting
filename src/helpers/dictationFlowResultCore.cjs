const { applyDictionaryCorrections } = require("../utils/dictionaryCorrectionCore.cjs");
const { normalizeChineseScript } = require("../utils/chineseScriptNormalizationCore.cjs");

function normalizeDurationMs(metadata = {}) {
  if (Number.isFinite(metadata.durationMs)) return Math.round(metadata.durationMs);
  if (Number.isFinite(metadata.audioDurationMs)) return Math.round(metadata.audioDurationMs);
  if (Number.isFinite(metadata.durationSeconds)) return Math.round(metadata.durationSeconds * 1000);
  return null;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueCorrections(corrections) {
  const seen = new Set();
  const unique = [];
  for (const correction of corrections) {
    const key = `${correction.from}\u0000${correction.to}\u0000${correction.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(correction);
  }
  return unique;
}

function normalizeCleanupError(value) {
  if (!value || typeof value !== "object") return undefined;
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message) return undefined;
  return {
    message,
    code: typeof value.code === "string" ? value.code : undefined,
    provider: typeof value.provider === "string" ? value.provider : undefined,
    model: typeof value.model === "string" ? value.model : undefined,
    stage: typeof value.stage === "string" ? value.stage : undefined,
  };
}

function correctResultText(rawText, refinedText, displayText, metadata = {}) {
  const options = {
    dictionary: metadata.customDictionary,
    aliases: metadata.customDictionaryAliases,
  };
  const corrections = [];

  const raw = applyDictionaryCorrections(rawText, options);
  corrections.push(...raw.replacements);

  const refined = refinedText
    ? applyDictionaryCorrections(refinedText, options)
    : { text: refinedText, replacements: [] };
  corrections.push(...refined.replacements);

  const display =
    displayText && displayText !== refinedText && displayText !== rawText
      ? applyDictionaryCorrections(displayText, options)
      : {
          text:
            displayText === refinedText
              ? refined.text
              : displayText === rawText
                ? raw.text
                : displayText,
          replacements: [],
        };
  corrections.push(...display.replacements);

  return {
    rawText: raw.text,
    refinedText: refined.text,
    displayText: display.text || refined.text || raw.text,
    corrections: uniqueCorrections(corrections),
  };
}

function normalizeProcessingMetadata(result, normalized, corrections, metadata = {}) {
  const existing =
    metadata.processingMetadata && typeof metadata.processingMetadata === "object"
      ? metadata.processingMetadata
      : result.processingMetadata && typeof result.processingMetadata === "object"
        ? result.processingMetadata
        : {};

  return {
    ...existing,
    voiceFlow: {
      ...(existing.voiceFlow && typeof existing.voiceFlow === "object" ? existing.voiceFlow : {}),
      mode: normalized.mode,
      provider: normalized.provider,
      model: normalized.model,
      language: normalized.language,
      scriptLanguage: normalized.scriptLanguage,
      rawText: normalized.rawText,
      refinedText: normalized.refinedText,
      displayText: normalized.displayText,
      warning: normalized.warning,
      cleanupError: normalized.cleanupError,
      dictionaryCorrections: corrections,
      timings: normalized.timings,
      chunksTotal: normalized.chunksTotal,
      chunksSucceeded: normalized.chunksSucceeded,
      chunksFailed: normalized.chunksFailed,
    },
  };
}

function normalizeTranscriptionResult(result = {}, metadata = {}) {
  const success = result.success !== false;
  const rawText = cleanText(result.rawText) || cleanText(result.text);
  const refinedText = cleanText(result.rawText) ? cleanText(result.refinedText ?? result.text) : "";
  const displayText = cleanText(result.displayText) || refinedText || rawText;
  const corrected = correctResultText(rawText, refinedText, displayText, metadata);
  const hasDictionaryCorrections = corrected.corrections.length > 0;
  const cleanupError = normalizeCleanupError(result.cleanupError ?? metadata.cleanupError);
  const language = metadata.language ?? result.language ?? null;
  const scriptLanguage =
    metadata.scriptLanguage ?? result.scriptLanguage ?? metadata.normalizationLanguage ?? language;
  const normalizedRefinedText = normalizeChineseScript(corrected.refinedText, scriptLanguage);
  const normalizedDisplayText = normalizeChineseScript(corrected.displayText, scriptLanguage);

  const normalized = {
    ...result,
    success,
    mode: metadata.mode ?? result.mode ?? "transcription",
    stage: success ? "complete" : "error",
    rawText: corrected.rawText,
    refinedText: normalizedRefinedText,
    displayText: normalizedDisplayText,
    text: normalizedDisplayText,
    provider: metadata.provider ?? result.provider ?? result.source ?? null,
    model: metadata.model ?? result.model ?? null,
    language,
    scriptLanguage,
    audioDurationMs: normalizeDurationMs(metadata) ?? result.audioDurationMs ?? null,
    timings: result.timings ?? metadata.timings ?? null,
    warning: pickDictationWarning(
      result.warning ?? metadata.warning ?? null,
      hasDictionaryCorrections ? "dictionary_corrected" : null
    ),
    cleanupError,
    partial: Boolean(result.partial ?? metadata.partial ?? false),
    dictionaryCorrections: hasDictionaryCorrections ? corrected.corrections : undefined,
    clientTranscriptionId: result.clientTranscriptionId ?? metadata.clientTranscriptionId,
    chunksTotal: result.chunksTotal ?? metadata.chunksTotal,
    chunksSucceeded: result.chunksSucceeded ?? metadata.chunksSucceeded,
    chunksFailed: result.chunksFailed ?? metadata.chunksFailed,
  };

  return {
    ...normalized,
    processingMetadata: normalizeProcessingMetadata(
      result,
      normalized,
      hasDictionaryCorrections ? corrected.corrections : [],
      metadata
    ),
  };
}

function normalizeDictationResult(result = {}, metadata = {}) {
  return {
    ...normalizeTranscriptionResult(result, { ...metadata, mode: "dictation" }),
    mode: "dictation",
  };
}

function resolveStreamingDictationText({ finalText, stopText, partialText } = {}) {
  const committedFinal = cleanText(finalText);
  if (committedFinal) {
    return {
      text: committedFinal,
      rawText: committedFinal,
      partial: false,
      warning: null,
      source: "final",
    };
  }

  const disconnectFinal = cleanText(stopText);
  if (disconnectFinal) {
    return {
      text: disconnectFinal,
      rawText: disconnectFinal,
      partial: false,
      warning: null,
      source: "disconnect",
    };
  }

  const partial = cleanText(partialText);
  if (partial) {
    return {
      text: partial,
      rawText: partial,
      partial: true,
      warning: "partial_result",
      source: "partial",
    };
  }

  return {
    text: "",
    rawText: "",
    partial: false,
    warning: null,
    source: "empty",
  };
}

async function settleStreamingStop(stopProvider, { timeoutMs = 2500 } = {}) {
  let timeoutId;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => stopProvider()),
      new Promise((resolve) => {
        timeoutId = setTimeout(
          () =>
            resolve({
              success: false,
              text: "",
              warning: "streaming_stop_timeout",
              timedOut: true,
            }),
          timeoutMs
        );
      }),
    ]);

    if (timeoutId) clearTimeout(timeoutId);
    if (result?.timedOut) return result;
    return {
      ...result,
      warning: result?.warning ?? null,
      timedOut: false,
    };
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    return {
      success: false,
      text: "",
      error: error?.message || String(error),
      warning: "streaming_stop_failed",
      timedOut: false,
    };
  }
}

function pickDictationWarning(...warnings) {
  const priority = [
    "cleanup_failed",
    "dictionary_prompt_truncated",
    "dictionary_corrected",
    "partial_result",
    "streaming_stop_timeout",
    "streaming_stop_failed",
  ];
  const present = warnings.filter(Boolean);
  return priority.find((warning) => present.includes(warning)) || present[0] || null;
}

function normalizeMeetingSegment(segment = {}, metadata = {}) {
  const type = segment.type || "final";
  const text = cleanText(segment.text);
  const partial = type === "partial";
  const corrected =
    partial || type === "retract"
      ? { text, replacements: [] }
      : applyDictionaryCorrections(text, {
          dictionary: metadata.customDictionary,
          aliases: metadata.customDictionaryAliases,
        });
  const hasDictionaryCorrections = corrected.replacements.length > 0;
  const language = metadata.language ?? segment.language ?? null;
  const scriptLanguage =
    metadata.scriptLanguage ?? segment.scriptLanguage ?? metadata.normalizationLanguage ?? language;
  const displayText = partial || type === "retract"
    ? corrected.text
    : normalizeChineseScript(corrected.text, scriptLanguage);

  return {
    ...segment,
    mode: "meeting",
    stage: type,
    text: displayText,
    rawText: text,
    refinedText: "",
    displayText,
    source: segment.source ?? metadata.source ?? null,
    type,
    timestamp: segment.timestamp ?? metadata.timestamp ?? null,
    provider: metadata.provider ?? segment.provider ?? null,
    model: metadata.model ?? segment.model ?? null,
    language,
    scriptLanguage,
    warning: pickDictationWarning(
      segment.warning ?? metadata.warning ?? null,
      hasDictionaryCorrections ? "dictionary_corrected" : null
    ),
    partial,
    dictionaryCorrections: hasDictionaryCorrections ? corrected.replacements : undefined,
  };
}

function normalizeMeetingTranscript(text, metadata = {}) {
  return normalizeTranscriptionResult(
    {
      success: true,
      text,
      rawText: text,
      provider: metadata.provider,
      model: metadata.model,
      language: metadata.language,
    },
    { ...metadata, mode: "meeting" }
  );
}

module.exports = {
  normalizeDictationResult,
  normalizeTranscriptionResult,
  normalizeMeetingSegment,
  normalizeMeetingTranscript,
  resolveStreamingDictationText,
  settleStreamingStop,
  pickDictationWarning,
};
