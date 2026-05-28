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

module.exports = { analyzePreviewPcmSpeech };
