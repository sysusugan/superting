const assert = require("node:assert/strict");
const test = require("node:test");

const IPCHandlers = require("../../src/helpers/ipcHandlers.js");
const {
  DEFAULT_EXPECTED_SPEAKER_COUNT,
  MAX_SPEAKER_COUNT,
} = require("../../src/constants/speakerDetection.json");

const { resolveSpeakerExpectation } = IPCHandlers;

test("default expected speaker count is a soft hint, not a fixed diarization count", () => {
  const result = resolveSpeakerExpectation({
    sessionConfig: { enabled: true, expectedCount: 2, expectedCountLocked: false },
    attendees: [],
    observedSpeakerIds: new Set(),
  });

  assert.equal(result.numSpeakers, -1);
  assert.equal(result.cap, MAX_SPEAKER_COUNT);
  assert.equal(result.softTarget, DEFAULT_EXPECTED_SPEAKER_COUNT);
  assert.equal(result.locked, false);
});

test("locked expected speaker count constrains diarization to other speakers", () => {
  const result = resolveSpeakerExpectation({
    sessionConfig: { enabled: true, expectedCount: 4, expectedCountLocked: true },
    attendees: [],
    observedSpeakerIds: new Set(["speaker_0", "speaker_1", "speaker_2"]),
  });

  assert.equal(result.numSpeakers, 3);
  assert.equal(result.cap, 3);
  assert.equal(result.softTarget, null);
  assert.equal(result.locked, true);
});

test("automatic mode uses attendees and observed speakers only as a soft target", () => {
  const result = resolveSpeakerExpectation({
    sessionConfig: null,
    attendees: [{}, {}, {}],
    observedSpeakerIds: new Set(["speaker_0", "speaker_1"]),
  });

  assert.equal(result.numSpeakers, -1);
  assert.equal(result.cap, MAX_SPEAKER_COUNT);
  assert.equal(result.softTarget, 3);
  assert.equal(result.locked, false);
});
