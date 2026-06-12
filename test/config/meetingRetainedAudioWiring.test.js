const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ipcHandlersPath = path.join(__dirname, "../../src/helpers/ipcHandlers.js");

test("meeting retained audio is wired through the retained audio writer", () => {
  const source = fs.readFileSync(ipcHandlersPath, "utf8");

  assert.match(source, /require\("\.\/meetingRetainedAudioWriter"\)/);
  assert.match(source, /new MeetingRetainedAudioWriter/);
  assert.match(source, /retainMeetingAudioChunk\(source, outbound\)/);
  assert.match(source, /persistMeetingAudioForNote\(\s*meetingNoteId,\s*retainedAudio/);
  assert.doesNotMatch(
    source,
    /persistMeetingAudioForNote\(\s*meetingNoteId,\s*diarizationPcmPath/,
    "meeting audio persistence must not use the diarization PCM stream"
  );
});

test("meeting audio retention treats -1 days as permanent retention", () => {
  const source = fs.readFileSync(ipcHandlersPath, "utf8");

  assert.match(
    source,
    /options\.dataRetentionEnabled !== false &&\s*\(options\.audioRetentionDays \?\? 30\) !== 0/,
    "meeting recording should retain audio for positive days and permanent -1 retention"
  );
});
