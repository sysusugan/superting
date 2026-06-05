function normalizeDurationMs(metadata = {}) {
  if (Number.isFinite(metadata.durationMs)) return Math.round(metadata.durationMs);
  if (Number.isFinite(metadata.audioDurationMs)) return Math.round(metadata.audioDurationMs);
  if (Number.isFinite(metadata.durationSeconds)) return Math.round(metadata.durationSeconds * 1000);
  return null;
}

function normalizeDictationResult(result = {}, metadata = {}) {
  const success = result.success !== false;
  const rawText = typeof result.rawText === "string" ? result.rawText.trim() : "";
  const refinedText = typeof result.text === "string" ? result.text.trim() : "";
  const displayText = refinedText || rawText;

  return {
    ...result,
    success,
    mode: "dictation",
    stage: success ? "complete" : "error",
    rawText,
    refinedText,
    displayText,
    text: displayText,
    provider: metadata.provider ?? result.provider ?? result.source ?? null,
    model: metadata.model ?? result.model ?? null,
    language: metadata.language ?? result.language ?? null,
    audioDurationMs: normalizeDurationMs(metadata),
    timings: result.timings ?? metadata.timings ?? null,
    warning: result.warning ?? metadata.warning ?? null,
    partial: Boolean(result.partial ?? metadata.partial ?? false),
    clientTranscriptionId: result.clientTranscriptionId ?? metadata.clientTranscriptionId,
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
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

module.exports = {
  normalizeDictationResult,
  resolveStreamingDictationText,
};
