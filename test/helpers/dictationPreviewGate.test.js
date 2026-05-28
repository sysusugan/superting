const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzePreviewPcmSpeech } = require("../../src/helpers/dictationPreviewGate");

function pcmFromSamples(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * 2);
  });
  return pcm;
}

test("skips near-silent preview chunks before local transcription", () => {
  const pcm = pcmFromSamples([0, 12, -10, 18, -16, 8]);

  const decision = analyzePreviewPcmSpeech(pcm);

  assert.equal(decision.shouldTranscribe, false);
  assert.equal(decision.reason, "silence");
});

test("skips weak background noise preview chunks before local transcription", () => {
  const pcm = pcmFromSamples([120, -110, 140, -125, 115, -130]);

  const decision = analyzePreviewPcmSpeech(pcm);

  assert.equal(decision.shouldTranscribe, false);
  assert.equal(decision.reason, "insufficient_speech");
});

test("allows speech-like preview chunks through", () => {
  const pcm = pcmFromSamples([1500, -1800, 2100, -2500, 1900, -2200]);

  const decision = analyzePreviewPcmSpeech(pcm);

  assert.equal(decision.shouldTranscribe, true);
  assert.equal(decision.reason, "speech_detected");
});
