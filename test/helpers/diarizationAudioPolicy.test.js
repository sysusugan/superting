const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DIARIZATION_PROFILES,
  mergeWindowSegments,
  planDiarizationWindows,
  scoreDiarizationWindow,
  selectDiarizationProfile,
} = require("../../src/helpers/diarizationAudioPolicy.js");

test("planDiarizationWindows uses five minute windows with overlap without exceeding duration", () => {
  const windows = planDiarizationWindows(720);

  assert.deepEqual(windows, [
    { index: 0, startSeconds: 0, endSeconds: 300, durationSeconds: 300 },
    { index: 1, startSeconds: 270, endSeconds: 570, durationSeconds: 300 },
    { index: 2, startSeconds: 540, endSeconds: 720, durationSeconds: 180 },
  ]);
});

test("selectDiarizationProfile classifies silent low signal and normal windows", () => {
  assert.equal(
    selectDiarizationProfile({
      durationSeconds: 300,
      meanVolumeDb: -90,
      maxVolumeDb: -80,
      activeRatio: 0,
      silenceRatio: 1,
    }).name,
    "silent"
  );

  assert.equal(
    selectDiarizationProfile({
      durationSeconds: 300,
      meanVolumeDb: -62,
      maxVolumeDb: -18,
      activeRatio: 0.12,
      silenceRatio: 0.88,
    }).name,
    "low_signal"
  );

  assert.equal(
    selectDiarizationProfile({
      durationSeconds: 300,
      meanVolumeDb: -38,
      maxVolumeDb: -6,
      activeRatio: 0.55,
      silenceRatio: 0.45,
    }).name,
    "normal"
  );
});

test("mergeWindowSegments offsets local window segments into the global timeline", () => {
  const merged = mergeWindowSegments([
    {
      startSeconds: 300,
      analysis: { activeRatio: 0.7, maxVolumeDb: -8 },
      profile: DIARIZATION_PROFILES.normal,
      segments: [{ start: 10, end: 20, speaker: "speaker_0" }],
    },
  ]);

  assert.deepEqual(merged, [{ start: 310, end: 320, speaker: "speaker_0" }]);
});

test("mergeWindowSegments does not reuse local speaker labels across unrelated windows", () => {
  const merged = mergeWindowSegments([
    {
      startSeconds: 0,
      analysis: { activeRatio: 0.7, maxVolumeDb: -8 },
      profile: DIARIZATION_PROFILES.normal,
      segments: [{ start: 10, end: 20, speaker: "speaker_0" }],
    },
    {
      startSeconds: 270,
      analysis: { activeRatio: 0.7, maxVolumeDb: -8 },
      profile: DIARIZATION_PROFILES.normal,
      segments: [{ start: 60, end: 70, speaker: "speaker_0" }],
    },
  ]);

  assert.deepEqual(merged, [
    { start: 10, end: 20, speaker: "speaker_0" },
    { start: 330, end: 340, speaker: "speaker_1" },
  ]);
});

test("mergeWindowSegments maps local speakers through overlapping window evidence", () => {
  const merged = mergeWindowSegments([
    {
      startSeconds: 0,
      analysis: { activeRatio: 0.7, maxVolumeDb: -8 },
      profile: DIARIZATION_PROFILES.normal,
      segments: [{ start: 285, end: 290, speaker: "speaker_0" }],
    },
    {
      startSeconds: 270,
      analysis: { activeRatio: 0.7, maxVolumeDb: -8 },
      profile: DIARIZATION_PROFILES.normal,
      segments: [
        { start: 15, end: 20, speaker: "speaker_7" },
        { start: 40, end: 50, speaker: "speaker_7" },
      ],
    },
  ]);

  assert.deepEqual(merged, [
    { start: 285, end: 290, speaker: "speaker_0" },
    { start: 310, end: 320, speaker: "speaker_0" },
  ]);
});

test("mergeWindowSegments keeps higher scoring segments in overlapping windows", () => {
  const quietScore = scoreDiarizationWindow(
    { activeRatio: 0.08, maxVolumeDb: -28 },
    DIARIZATION_PROFILES.low_signal
  );
  const clearScore = scoreDiarizationWindow(
    { activeRatio: 0.62, maxVolumeDb: -8 },
    DIARIZATION_PROFILES.normal
  );

  assert.ok(clearScore > quietScore);

  const merged = mergeWindowSegments([
    {
      startSeconds: 0,
      analysis: { activeRatio: 0.08, maxVolumeDb: -28 },
      profile: DIARIZATION_PROFILES.low_signal,
      segments: [{ start: 285, end: 295, speaker: "speaker_0" }],
    },
    {
      startSeconds: 270,
      analysis: { activeRatio: 0.62, maxVolumeDb: -8 },
      profile: DIARIZATION_PROFILES.normal,
      segments: [{ start: 12, end: 25, speaker: "speaker_1" }],
    },
  ]);

  assert.deepEqual(merged, [{ start: 282, end: 295, speaker: "speaker_0" }]);
});
