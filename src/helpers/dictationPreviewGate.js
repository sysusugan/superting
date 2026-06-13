const SILENCE_RMS_THRESHOLD = 0.002;
const SPEECH_WINDOW_RMS_THRESHOLD = 0.003;
const SPEECH_WINDOW_PEAK_THRESHOLD = 0.02;
const STRONG_SPEECH_RMS_THRESHOLD = 0.006;

function analyzePreviewPcmSpeech(pcm) {
  if (!pcm || pcm.length < 2) {
    return {
      shouldTranscribe: false,
      reason: "empty",
      rms: 0,
      peakAmplitude: 0,
      samples: 0,
    };
  }

  const sampleCount = Math.floor(pcm.length / 2);
  let sumSq = 0;
  let peakAmplitude = 0;

  for (let i = 0; i < sampleCount; i++) {
    const n = pcm.readInt16LE(i * 2) / 0x7fff;
    sumSq += n * n;
    peakAmplitude = Math.max(peakAmplitude, Math.abs(n));
  }

  const rms = Math.sqrt(sumSq / sampleCount);

  if (rms < SILENCE_RMS_THRESHOLD) {
    return {
      shouldTranscribe: false,
      reason: "silence",
      rms,
      peakAmplitude,
      samples: sampleCount,
    };
  }

  const hasSpeech =
    (rms >= SPEECH_WINDOW_RMS_THRESHOLD && peakAmplitude >= SPEECH_WINDOW_PEAK_THRESHOLD) ||
    rms >= STRONG_SPEECH_RMS_THRESHOLD;

  if (!hasSpeech) {
    return {
      shouldTranscribe: false,
      reason: "insufficient_speech",
      rms,
      peakAmplitude,
      samples: sampleCount,
    };
  }

  return {
    shouldTranscribe: true,
    reason: "speech_detected",
    rms,
    peakAmplitude,
    samples: sampleCount,
  };
}

function isUsablePreviewTranscript(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return false;

  const codeIndicators = [
    /\bconst\s+\w+\s*=/,
    /\bif\s*\([^)]{3,}\)\s*\{/,
    /\breturn\s+(?:true|false|null|undefined|\w+)/,
    /=>/,
    /#\w+/,
    /\/\/\s*\w+/,
    /\bthis\.\s*#?\w+|\bthis\.#\w+/,
    /\bhostname\b.*\bno[_-]?proxy\b/i,
  ];
  const indicatorCount = codeIndicators.reduce(
    (count, pattern) => count + (pattern.test(value) ? 1 : 0),
    0
  );
  const punctuationCount = (value.match(/[{}()[\];=]/g) || []).length;
  const punctuationRatio = punctuationCount / Math.max(value.length, 1);

  return !(indicatorCount >= 3 && punctuationRatio > 0.035);
}

module.exports = { analyzePreviewPcmSpeech, isUsablePreviewTranscript };
