const { applyDictionaryCorrections } = require("../utils/dictionaryCorrectionCore.cjs");

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
      rawText: normalized.rawText,
      refinedText: normalized.refinedText,
      displayText: normalized.displayText,
      warning: normalized.warning,
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

  const normalized = {
    ...result,
    success,
    mode: metadata.mode ?? result.mode ?? "transcription",
    stage: success ? "complete" : "error",
    rawText: corrected.rawText,
    refinedText: corrected.refinedText,
    displayText: corrected.displayText,
    text: corrected.displayText,
    provider: metadata.provider ?? result.provider ?? result.source ?? null,
    model: metadata.model ?? result.model ?? null,
    language: metadata.language ?? result.language ?? null,
    audioDurationMs: normalizeDurationMs(metadata) ?? result.audioDurationMs ?? null,
    timings: result.timings ?? metadata.timings ?? null,
    warning: pickDictationWarning(
      result.warning ?? metadata.warning ?? null,
      hasDictionaryCorrections ? "dictionary_corrected" : null
    ),
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

  return {
    ...segment,
    mode: "meeting",
    stage: type,
    text,
    rawText: text,
    refinedText: "",
    displayText: text,
    source: segment.source ?? metadata.source ?? null,
    type,
    timestamp: segment.timestamp ?? metadata.timestamp ?? null,
    provider: metadata.provider ?? segment.provider ?? null,
    model: metadata.model ?? segment.model ?? null,
    language: metadata.language ?? segment.language ?? null,
    warning: segment.warning ?? metadata.warning ?? null,
    partial,
  };
}

module.exports = {
  normalizeDictationResult,
  normalizeTranscriptionResult,
  normalizeMeetingSegment,
  resolveStreamingDictationText,
  settleStreamingStop,
  pickDictationWarning,
};
