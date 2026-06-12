import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTranscriptTimestamp,
  getElapsedRecordingSeconds,
  getRelativeTranscriptSeconds,
  getTranscriptSeekSeconds,
} from "../../src/utils/recordingTime.ts";

test("recording elapsed seconds are derived from the session start timestamp", () => {
  assert.equal(getElapsedRecordingSeconds(null, 71_000), 0);
  assert.equal(getElapsedRecordingSeconds(10_000, 71_499), 61);
  assert.equal(getElapsedRecordingSeconds(72_000, 71_000), 0);
});

test("transcript timestamps render relative clock labels", () => {
  assert.equal(formatTranscriptTimestamp(13.4), "00:13");
  assert.equal(formatTranscriptTimestamp(3661), "01:01:01");
  assert.equal(formatTranscriptTimestamp(1_700_000_013_400, 1_700_000_000_000), "00:13");
  assert.equal(formatTranscriptTimestamp(undefined), "");
});

test("epoch transcript timestamps normalize to relative seconds", () => {
  assert.equal(getRelativeTranscriptSeconds(1_700_000_013_400, 1_700_000_000_000), 13.4);
  assert.equal(getRelativeTranscriptSeconds(42.5, 1_700_000_000_000), 42.5);
  assert.equal(getRelativeTranscriptSeconds(undefined, 1_700_000_000_000), undefined);
});

test("centisecond-style transcript timestamps normalize to audio seconds", () => {
  assert.equal(formatTranscriptTimestamp(18_018, null, 300), "03:00");
  assert.equal(getTranscriptSeekSeconds(18_018, null, 300), 180.18);
});

test("epoch transcript timestamps seek relative to the recording start", () => {
  assert.equal(getTranscriptSeekSeconds(1_700_000_240_000, 1_700_000_000_000), 240);
});
