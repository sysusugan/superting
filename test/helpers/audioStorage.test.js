const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AudioStorageManager = require("../../src/helpers/audioStorage");

function buildTestWav(pcmBytes, { sampleRate = 24000, channels = 1 } = {}) {
  const bytesPerSample = 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBytes.length, 40);
  return Buffer.concat([header, pcmBytes]);
}

test("saveMeetingPcmAudio writes retained meeting Opus WebM and reports storage usage", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pcmPath = path.join(root, "meeting.pcm");
  const pcmBytes = Buffer.alloc(48000);
  fs.writeFileSync(pcmPath, pcmBytes);

  const storage = new AudioStorageManager({ audioDir: path.join(root, "audio") });
  const result = await storage.saveMeetingPcmAudio(12, pcmPath, new Date(2026, 4, 28, 6, 7, 8), {
    sampleRate: 24000,
    channels: 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.filename, "OpenWhispr-meeting-2026-05-28-06-07-08-12.webm");
  assert.equal(result.durationSeconds, 1);

  const webm = fs.readFileSync(result.path);
  assert.equal(webm[0], 0x1a);
  assert.equal(webm[1], 0x45);
  assert.equal(webm[2], 0xdf);
  assert.equal(webm[3], 0xa3);
  assert.ok(webm.length < pcmBytes.length, `expected ${webm.length} < ${pcmBytes.length}`);

  assert.deepEqual(storage.getStorageUsage(), {
    fileCount: 1,
    totalBytes: webm.length,
    uncompressedCount: 0,
  });
});

test("saveMeetingPcmAudio falls back to retained WAV when Opus compression fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pcmPath = path.join(root, "meeting.pcm");
  const pcmBytes = Buffer.alloc(48000);
  fs.writeFileSync(pcmPath, pcmBytes);

  const storage = new AudioStorageManager({
    audioDir: path.join(root, "audio"),
    compressToOpusWebm: async () => {
      throw new Error("forced compression failure");
    },
  });
  const result = await storage.saveMeetingPcmAudio(12, pcmPath, new Date(2026, 4, 28, 6, 7, 8), {
    sampleRate: 24000,
    channels: 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.filename, "OpenWhispr-meeting-2026-05-28-06-07-08-12.wav");
  assert.equal(result.compressed, false);

  const wav = fs.readFileSync(result.path);
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt32LE(40), pcmBytes.length);
});

test("mergeRetainedAudioToOpusWebm creates a retained merged WebM from note audio files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const first = path.join(audioDir, "OpenWhispr-meeting-2026-05-28-06-00-00-12.wav");
  const second = path.join(audioDir, "OpenWhispr-meeting-2026-05-28-06-10-00-12.wav");
  const pcm = Buffer.alloc(24000);
  fs.writeFileSync(first, buildTestWav(pcm));
  fs.writeFileSync(second, buildTestWav(pcm));

  const result = await storage.mergeRetainedAudioToOpusWebm(
    12,
    [path.basename(first), path.basename(second)],
    new Date(2026, 4, 28, 6, 30, 0)
  );

  assert.equal(result.success, true);
  assert.equal(result.filename, "OpenWhispr-meeting-merged-2026-05-28-06-30-00-12.webm");
  const merged = fs.readFileSync(result.path);
  assert.equal(merged[0], 0x1a);
  assert.equal(merged[1], 0x45);
  assert.equal(merged[2], 0xdf);
  assert.equal(merged[3], 0xa3);
});

test("compressRetainedAudioToOpusWebm converts retained WAV to same basename WebM", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const wavName = "OpenWhispr-meeting-2026-05-28-06-00-00-12.wav";
  fs.writeFileSync(path.join(audioDir, wavName), buildTestWav(Buffer.alloc(24000)));

  const result = await storage.compressRetainedAudioToOpusWebm(wavName);

  assert.equal(result.success, true);
  assert.equal(result.filename, "OpenWhispr-meeting-2026-05-28-06-00-00-12.webm");
  const compressed = fs.readFileSync(result.path);
  assert.equal(compressed[0], 0x1a);
  assert.equal(compressed[1], 0x45);
});

test("compressRetainedAudioToOpusWebm returns existing WebM without rewriting", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const webmName = "OpenWhispr-meeting-2026-05-28-06-00-00-12.webm";
  const webmPath = path.join(audioDir, webmName);
  fs.writeFileSync(webmPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

  const result = await storage.compressRetainedAudioToOpusWebm(webmName);

  assert.equal(result.success, true);
  assert.equal(result.filename, webmName);
  assert.equal(result.alreadyCompressed, true);
  assert.equal(fs.readFileSync(webmPath).length, 4);
});

test("compressAllRetainedAudioToOpusWebm compresses only uncompressed retained audio", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const wavName = "OpenWhispr-meeting-2026-05-28-06-00-00-12.wav";
  const webmName = "OpenWhispr-meeting-2026-05-28-06-10-00-12.webm";
  fs.writeFileSync(path.join(audioDir, wavName), buildTestWav(Buffer.alloc(24000)));
  fs.writeFileSync(path.join(audioDir, webmName), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

  const replacements = [];
  const result = await storage.compressAllRetainedAudioToOpusWebm({
    onCompressed: (sourceFilename, compressed) => {
      replacements.push([sourceFilename, compressed.filename]);
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.scanned, 2);
  assert.equal(result.compressed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(replacements, [
    [wavName, "OpenWhispr-meeting-2026-05-28-06-00-00-12.webm"],
  ]);
  assert.equal(fs.existsSync(path.join(audioDir, wavName)), false);
  assert.equal(fs.existsSync(path.join(audioDir, webmName)), true);
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

test("deleteRetainedAudioFiles deletes safe retained audio and rejects unsafe names", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const audioDir = path.join(root, "audio");
  const storage = new AudioStorageManager({ audioDir });
  const existing = "OpenWhispr-meeting-2026-05-29-06-07-08-12.wav";
  const missing = "OpenWhispr-meeting-2026-05-29-06-07-09-12.wav";
  const unsafe = "../secret.wav";
  fs.writeFileSync(path.join(audioDir, existing), Buffer.from("wav"));

  const result = storage.deleteRetainedAudioFiles([existing, missing, unsafe]);

  assert.equal(result.success, false);
  assert.deepEqual(result.deleted, [existing]);
  assert.deepEqual(result.missing, [missing]);
  assert.deepEqual(result.failed, [{ filename: unsafe, error: "Invalid audio filename" }]);
  assert.equal(fs.existsSync(path.join(audioDir, existing)), false);
});
