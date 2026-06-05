const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAudioDownloadFilename,
  buildMergedMeetingAudioFilename,
  buildMeetingAudioFilename,
  isRetainedAudioFile,
  parseMeetingAudioFilename,
  resolveRetainedAudioPath,
} = require("../../src/helpers/audioStorageFiles");

test("buildMeetingAudioFilename namespaces meeting note audio as WebM", () => {
  const filename = buildMeetingAudioFilename(42, new Date(2026, 4, 28, 6, 7, 8));

  assert.match(filename, /^OpenWhispr-meeting-2026-05-28-06-07-08-42\.webm$/);
});

test("buildMergedMeetingAudioFilename namespaces merged meeting audio as WebM", () => {
  const filename = buildMergedMeetingAudioFilename(42, new Date(2026, 4, 28, 6, 7, 8));

  assert.match(filename, /^OpenWhispr-meeting-merged-2026-05-28-06-07-08-42\.webm$/);
});

test("parseMeetingAudioFilename extracts note id and recording time", () => {
  assert.deepEqual(parseMeetingAudioFilename("OpenWhispr-meeting-2026-05-28-06-07-08-42.wav"), {
    noteId: 42,
    recordedAt: new Date(2026, 4, 28, 6, 7, 8).toISOString(),
    isMerged: false,
  });
  assert.deepEqual(parseMeetingAudioFilename("OpenWhispr-meeting-2026-05-28-06-07-08-42.webm"), {
    noteId: 42,
    recordedAt: new Date(2026, 4, 28, 6, 7, 8).toISOString(),
    isMerged: false,
  });
  assert.deepEqual(
    parseMeetingAudioFilename("OpenWhispr-meeting-merged-2026-05-28-06-07-08-42.webm"),
    {
      noteId: 42,
      recordedAt: new Date(2026, 4, 28, 6, 7, 8).toISOString(),
      isMerged: true,
    }
  );
  assert.equal(parseMeetingAudioFilename("OpenWhispr-2026-05-28-06-07-08-42.webm"), null);
  assert.equal(parseMeetingAudioFilename("OpenWhispr-meeting-2026-05-28-06-07-08-x.wav"), null);
});

test("isRetainedAudioFile includes dictation webm and meeting audio files", () => {
  assert.equal(isRetainedAudioFile("OpenWhispr-2026-05-28-06-07-08-1.webm"), true);
  assert.equal(isRetainedAudioFile("OpenWhispr-meeting-2026-05-28-06-07-08-42.wav"), true);
  assert.equal(isRetainedAudioFile("OpenWhispr-meeting-2026-05-28-06-07-08-42.webm"), true);
  assert.equal(
    isRetainedAudioFile("OpenWhispr-meeting-merged-2026-05-28-06-07-08-42.webm"),
    true
  );
  assert.equal(isRetainedAudioFile("notes.txt"), false);
});

test("resolveRetainedAudioPath only resolves retained files inside the audio directory", () => {
  const audioDir = "/tmp/openwhispr-audio";

  assert.equal(
    resolveRetainedAudioPath(audioDir, "OpenWhispr-meeting-2026-05-28-06-07-08-42.wav"),
    "/tmp/openwhispr-audio/OpenWhispr-meeting-2026-05-28-06-07-08-42.wav"
  );
  assert.equal(resolveRetainedAudioPath(audioDir, "../secret.wav"), null);
  assert.equal(resolveRetainedAudioPath(audioDir, "notes.txt"), null);
});

test("buildAudioDownloadFilename uses a safe note title and original extension", () => {
  assert.equal(
    buildAudioDownloadFilename("生访测试方案/风险评估", "OpenWhispr-meeting-1.wav"),
    "生访测试方案-风险评估.wav"
  );
  assert.equal(buildAudioDownloadFilename("", "OpenWhispr-1.webm"), "OpenWhispr-audio.webm");
});
