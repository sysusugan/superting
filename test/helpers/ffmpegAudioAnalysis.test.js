const assert = require("node:assert/strict");
const test = require("node:test");

const {
  _buildExtractWindowArgs,
  _buildPeakNormalizeArgs,
  parseAudioAnalysis,
} = require("../../src/helpers/ffmpegUtils");

test("parseAudioAnalysis extracts volume and active ratio from ffmpeg stderr", () => {
  const analysis = parseAudioAnalysis(`
    Duration: 00:00:10.00, start: 0.000000, bitrate: 256 kb/s
    [silencedetect @ 0x123] silence_start: 1
    [silencedetect @ 0x123] silence_end: 3 | silence_duration: 2
    [silencedetect @ 0x123] silence_start: 6
    [silencedetect @ 0x123] silence_end: 8 | silence_duration: 2
    [Parsed_volumedetect_1 @ 0x456] mean_volume: -42.0 dB
    [Parsed_volumedetect_1 @ 0x456] max_volume: -6.0 dB
  `);

  assert.equal(analysis.durationSeconds, 10);
  assert.equal(analysis.meanVolumeDb, -42);
  assert.equal(analysis.maxVolumeDb, -6);
  assert.equal(analysis.silenceRatio, 0.4);
  assert.equal(analysis.activeRatio, 0.6);
});

test("parseAudioAnalysis treats open ended trailing silence as silent until duration end", () => {
  const analysis = parseAudioAnalysis(`
    Duration: 00:00:05.00, start: 0.000000, bitrate: 256 kb/s
    [silencedetect @ 0x123] silence_start: 2
    [Parsed_volumedetect_1 @ 0x456] mean_volume: -90.0 dB
    [Parsed_volumedetect_1 @ 0x456] max_volume: -80.0 dB
  `);

  assert.equal(analysis.silenceRatio, 0.6);
  assert.equal(analysis.activeRatio, 0.4);
});

test("_buildExtractWindowArgs creates a wav slice at 16k mono", () => {
  assert.deepEqual(
    _buildExtractWindowArgs({
      input: "/tmp/in.wav",
      output: "/tmp/out.wav",
      startSeconds: 270,
      durationSeconds: 300,
    }),
    [
      "-ss",
      "270",
      "-t",
      "300",
      "-i",
      "/tmp/in.wav",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      "/tmp/out.wav",
    ]
  );
});

test("_buildPeakNormalizeArgs limits gain while targeting a peak volume", () => {
  assert.deepEqual(
    _buildPeakNormalizeArgs({
      input: "/tmp/in.wav",
      output: "/tmp/out.wav",
      currentPeakDb: -34,
      targetPeakDb: -10,
      maxGainDb: 18,
    }),
    ["-i", "/tmp/in.wav", "-af", "volume=18dB", "-ar", "16000", "-ac", "1", "-y", "/tmp/out.wav"]
  );
});
