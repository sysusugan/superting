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

function normalizePreviewText(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[，。！？、,.!?;；:："'“”‘’()\[\]【】<>《》]/g, "");
}

function isLikelyPreviewNoiseTranscript(text) {
  const value = normalizePreviewText(text);
  if (!value) return true;

  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 8 && /^(好|嗯|对|啊|呃|额|唉|哎|哈|是)\1{2,}$/.test(compact)) {
    return true;
  }

  const shortNoisePhrases = new Set([
    "谢谢大家",
    "感谢观看",
    "感谢您的观看",
    "谢谢观看",
    "谢谢您的观看",
    "多谢观看",
    "thanksforwatching",
    "thankyouforwatching",
  ]);
  const latinCompact = compact.toLowerCase();
  if (
    compact.length <= 12 &&
    (shortNoisePhrases.has(compact) || shortNoisePhrases.has(latinCompact))
  ) {
    return true;
  }

  if (compact.length <= 24 && /^字幕由.+(?:提供|制作|社区提供)$/.test(compact)) {
    return true;
  }

  return false;
}

function isUsablePreviewTranscript(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return false;
  if (isLikelyPreviewNoiseTranscript(value)) return false;

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

module.exports = {
  analyzePreviewPcmSpeech,
  isLikelyPreviewNoiseTranscript,
  isUsablePreviewTranscript,
};
