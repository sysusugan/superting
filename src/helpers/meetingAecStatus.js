function resolveMeetingAecStartStatus({
  systemAudioMode,
  helperSupported,
  helperAvailable,
  started,
}) {
  if (systemAudioMode === "unsupported") {
    return { aecMode: "unavailable", aecReason: "system-audio-missing" };
  }

  if (!helperSupported) {
    return { aecMode: "unavailable", aecReason: "unsupported-platform" };
  }

  if (!helperAvailable) {
    return { aecMode: "fallback", aecReason: "helper-unavailable" };
  }

  if (!started) {
    return { aecMode: "fallback", aecReason: "helper-error" };
  }

  return { aecMode: "enabled", aecReason: null };
}

function resolveMeetingAecSystemAudioFailure() {
  return { aecMode: "fallback", aecReason: "system-audio-start-failed" };
}

module.exports = {
  resolveMeetingAecStartStatus,
  resolveMeetingAecSystemAudioFailure,
};
