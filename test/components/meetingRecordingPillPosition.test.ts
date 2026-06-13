import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMeetingRecordingPillPosition,
  getDefaultMeetingRecordingPillPosition,
  parseMeetingRecordingPillPosition,
} from "../../src/components/notes/meetingRecordingPillPosition.ts";

test("defaults the meeting recording pill to top center", () => {
  assert.deepEqual(
    getDefaultMeetingRecordingPillPosition({
      viewportWidth: 1200,
      viewportHeight: 800,
      pillWidth: 220,
      pillHeight: 36,
    }),
    { x: 490, y: 8 }
  );
});

test("clamps the meeting recording pill inside the viewport", () => {
  assert.deepEqual(
    clampMeetingRecordingPillPosition(
      { x: 980, y: -40 },
      {
        viewportWidth: 1000,
        viewportHeight: 600,
        pillWidth: 180,
        pillHeight: 36,
      }
    ),
    { x: 812, y: 8 }
  );
});

test("falls back from invalid stored meeting recording pill positions", () => {
  assert.equal(parseMeetingRecordingPillPosition("null"), null);
  assert.equal(parseMeetingRecordingPillPosition('{"x":"10","y":20}'), null);
  assert.equal(parseMeetingRecordingPillPosition("not json"), null);
});

test("parses valid stored meeting recording pill positions", () => {
  assert.deepEqual(parseMeetingRecordingPillPosition('{"x":16,"y":24}'), { x: 16, y: 24 });
});
