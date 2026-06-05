export function getPreviewPhaseForResult(payload = {}) {
  return payload?.warning === "cleanup_failed" ? "fallback" : "final";
}

export function getPreviewStatusKey(phase) {
  if (phase === "final") return "transcriptionPreview.ready";
  if (phase === "fallback") return "transcriptionPreview.usingOriginal";
  if (phase === "cleanup") return "transcriptionPreview.polishing";
  return "transcriptionPreview.listening";
}
