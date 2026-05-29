const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AudioStorageManager = require("../../src/helpers/audioStorage");

test("saveMeetingPcmAudio writes retained meeting wav and reports storage usage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pcmPath = path.join(root, "meeting.pcm");
  const pcmBytes = Buffer.alloc(48000);
  fs.writeFileSync(pcmPath, pcmBytes);

  const storage = new AudioStorageManager({ audioDir: path.join(root, "audio") });
  const result = storage.saveMeetingPcmAudio(12, pcmPath, new Date(2026, 4, 28, 6, 7, 8), {
    sampleRate: 24000,
    channels: 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.filename, "OpenWhispr-meeting-2026-05-28-06-07-08-12.wav");
  assert.equal(result.durationSeconds, 1);

  const wav = fs.readFileSync(result.path);
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.subarray(36, 40).toString("ascii"), "data");
  assert.equal(wav.readUInt32LE(40), pcmBytes.length);
  assert.equal(wav.length, pcmBytes.length + 44);

  assert.deepEqual(storage.getStorageUsage(), {
    fileCount: 1,
    totalBytes: pcmBytes.length + 44,
  });
});

test("getRetainedAudioPath returns existing retained audio and rejects missing or unsafe names", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const filename = "OpenWhispr-meeting-2026-05-28-06-07-08-12.wav";
  const audioPath = path.join(audioDir, filename);
  fs.writeFileSync(audioPath, Buffer.from("wav"));

  assert.equal(storage.getRetainedAudioPath(filename), audioPath);
  assert.equal(storage.getRetainedAudioPath("missing.wav"), null);
  assert.equal(storage.getRetainedAudioPath("../secret.wav"), null);
});

test("cleanupExpiredAudio reports deleted retained note audio filenames to database", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const expired = "OpenWhispr-meeting-2026-05-28-06-07-08-12.wav";
  const retained = "OpenWhispr-meeting-2026-05-29-06-07-08-12.wav";
  fs.writeFileSync(path.join(audioDir, expired), Buffer.from("old"));
  fs.writeFileSync(path.join(audioDir, retained), Buffer.from("new"));

  const oldTime = Date.now() - 40 * 86400000;
  fs.utimesSync(path.join(audioDir, expired), oldTime / 1000, oldTime / 1000);

  let deletedFilenames = null;
  let remainingFilenames = null;
  const result = storage.cleanupExpiredAudio(30, {
    clearAudioFlags() {},
    removeNoteAudioFilesByFilename(deleted, remaining) {
      deletedFilenames = deleted;
      remainingFilenames = remaining;
    },
  });

  assert.equal(result.deleted, 1);
  assert.deepEqual(deletedFilenames, [expired]);
  assert.deepEqual(remainingFilenames, [retained]);
});
