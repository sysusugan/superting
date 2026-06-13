const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzePreviewPcmSpeech,
  isUsablePreviewTranscript,
} = require("../../src/helpers/dictationPreviewGate");

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

test("skips weak background noise meeting chunks before local transcription", () => {
  const pcm = pcmFromSamples([96, -118, 132, -105, 124, -116, 110, -128]);

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

test("rejects source-code hallucinations from realtime preview chunks", () => {
  const text =
    "if (hostname === entry.hostname) { return false } else { // Don't proxy if the hostname ends with the no_proxy host. if (hostname.endsWith(entry.hostname.replace(/^\\*/, ''))) { return false } } return true } #parseNoProxy () { const noProxyValue = this.#opts.noProxy ?? this.#noProxyEnv";

  assert.equal(isUsablePreviewTranscript(text), false);
});

test("allows normal dictated preview text", () => {
  assert.equal(isUsablePreviewTranscript("Please send the meeting notes after lunch."), true);
});
