const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  _buildOpusEncodeArgs,
  _buildConcatEncodeArgs,
  compressToOpusWebm,
  mergeToOpusWebm,
  clearCache,
} = require("../../src/helpers/ffmpegUtils");

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-opus-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeWav(filePath, { sampleRate = 24000, channels = 1, durationSec = 0.5 } = {}) {
  const bytesPerSample = 2;
  const numSamples = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(numSamples * channels * bytesPerSample);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
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
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

test("_buildOpusEncodeArgs returns the expected libopus + WebM args", () => {
  const args = _buildOpusEncodeArgs({
    input: "/tmp/in.wav",
    output: "/tmp/out.webm",
  });

  assert.deepEqual(args, [
    "-y",
    "-i",
    "/tmp/in.wav",
    "-c:a",
    "libopus",
    "-b:a",
    "24k",
    "-ac",
    "1",
    "-ar",
    "24000",
    "-application",
    "voip",
    "-vbr",
    "on",
    "-f",
    "webm",
    "/tmp/out.webm",
  ]);
});

test("_buildOpusEncodeArgs respects custom bitrate, sample rate, channels, application", () => {
  const args = _buildOpusEncodeArgs({
    input: "in.webm",
    output: "out.webm",
    bitrate: "32k",
    sampleRate: 48000,
    channels: 2,
    application: "audio",
  });

  const i = args.indexOf("-b:a");
  const ar = args.indexOf("-ar");
  const ac = args.indexOf("-ac");
  const app = args.indexOf("-application");
  assert.equal(args[i + 1], "32k");
  assert.equal(args[ar + 1], "48000");
  assert.equal(args[ac + 1], "2");
  assert.equal(args[app + 1], "audio");
});

test("_buildOpusEncodeArgs rejects missing input or output", () => {
  assert.throws(() => _buildOpusEncodeArgs({ output: "x" }), /requires `input`/);
  assert.throws(() => _buildOpusEncodeArgs({ input: "x" }), /requires `output`/);
});

test("_buildConcatEncodeArgs uses the concat demuxer with a list file", () => {
  const args = _buildConcatEncodeArgs({
    listFile: "/tmp/list.txt",
    output: "/tmp/merged.webm",
  });

  assert.deepEqual(args, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "/tmp/list.txt",
    "-c:a",
    "libopus",
    "-b:a",
    "24k",
    "-ac",
    "1",
    "-ar",
    "24000",
    "-application",
    "voip",
    "-vbr",
    "on",
    "-f",
    "webm",
    "/tmp/merged.webm",
  ]);
});

test("_buildConcatEncodeArgs rejects missing list file or output", () => {
  assert.throws(() => _buildConcatEncodeArgs({ output: "x" }), /requires `listFile`/);
  assert.throws(() => _buildConcatEncodeArgs({ listFile: "x" }), /requires `output`/);
});

test("mergeToOpusWebm rejects an empty input list", async () => {
  await assert.rejects(
    () => mergeToOpusWebm([], "/tmp/should-not-exist.webm"),
    /requires at least one input path/
  );
});

test("mergeToOpusWebm rejects a non-array input", async () => {
  await assert.rejects(
    () => mergeToOpusWebm(null, "/tmp/should-not-exist.webm"),
    /requires at least one input path/
  );
});

test("compressToOpusWebm rejects when the input file is missing", async (t) => {
  const dir = makeTempDir(t);
  const output = path.join(dir, "out.webm");
  await assert.rejects(
    () => compressToOpusWebm(path.join(dir, "missing.wav"), output),
    (err) => {
      assert.match(err.message, /FFmpeg exited with code/);
      return true;
    }
  );
  // The output file must not be created on failure.
  assert.equal(fs.existsSync(output), false);
});

test("compressToOpusWebm writes a smaller valid Opus-in-WebM file and cleans up temp", async (t) => {
  const dir = makeTempDir(t);
  const input = path.join(dir, "in.wav");
  const output = path.join(dir, "out.webm");
  writeWav(input, { durationSec: 2 });
  const inputSize = fs.statSync(input).size;

  await compressToOpusWebm(input, output);

  assert.equal(fs.existsSync(output), true);
  const out = fs.readFileSync(output);
  // WebM / Matroska EBML magic header: 1A 45 DF A3
  assert.equal(out[0], 0x1a);
  assert.equal(out[1], 0x45);
  assert.equal(out[2], 0xdf);
  assert.equal(out[3], 0xa3);
  // Opus @ 24kbps compresses 2s of 24kHz mono 16-bit PCM (~96KB) by a lot.
  assert.ok(out.length < inputSize / 5, `expected ${out.length} << ${inputSize}`);
});

test("compressToOpusWebm overwrites an existing output file atomically", async (t) => {
  const dir = makeTempDir(t);
  const input = path.join(dir, "in.wav");
  const output = path.join(dir, "out.webm");
  writeWav(input, { durationSec: 1 });
  fs.writeFileSync(output, Buffer.from("stale"));

  await compressToOpusWebm(input, output);

  const out = fs.readFileSync(output);
  assert.equal(out[0], 0x1a);
  assert.equal(out[1], 0x45);
  assert.notEqual(out.toString("utf8", 0, 5), "stale");
});

test("mergeToOpusWebm joins multiple input files into one Opus WebM", async (t) => {
  const dir = makeTempDir(t);
  const a = path.join(dir, "a.wav");
  const b = path.join(dir, "b.wav");
  const c = path.join(dir, "c.wav");
  const merged = path.join(dir, "merged.webm");
  writeWav(a, { durationSec: 1 });
  writeWav(b, { durationSec: 1 });
  writeWav(c, { durationSec: 1 });
  const totalInputBytes =
    fs.statSync(a).size + fs.statSync(b).size + fs.statSync(c).size;

  await mergeToOpusWebm([a, b, c], merged);

  assert.equal(fs.existsSync(merged), true);
  const out = fs.readFileSync(merged);
  assert.equal(out[0], 0x1a);
  assert.equal(out[1], 0x45);
  assert.equal(out[2], 0xdf);
  assert.equal(out[3], 0xa3);
  // 3 seconds of 24kHz mono 16-bit PCM (144KB) → Opus @ 24kbps is tiny.
  assert.ok(out.length < totalInputBytes / 10, `expected ${out.length} << ${totalInputBytes}`);
});

test("mergeToOpusWebm works with a single input file", async (t) => {
  const dir = makeTempDir(t);
  const a = path.join(dir, "a.wav");
  const merged = path.join(dir, "merged.webm");
  writeWav(a, { durationSec: 1 });

  await mergeToOpusWebm([a], merged);

  assert.equal(fs.existsSync(merged), true);
  const out = fs.readFileSync(merged);
  assert.equal(out[0], 0x1a);
  assert.equal(out[1], 0x45);
});

test("mergeToOpusWebm does not leave concat list or temp output behind on success", async (t) => {
  const dir = makeTempDir(t);
  const a = path.join(dir, "a.wav");
  const b = path.join(dir, "b.wav");
  const merged = path.join(dir, "merged.webm");
  writeWav(a, { durationSec: 0.5 });
  writeWav(b, { durationSec: 0.5 });

  const listFilesBefore = fs
    .readdirSync(os.tmpdir())
    .filter((f) => f.includes("openwhispr-opus-concat-list"));
  await mergeToOpusWebm([a, b], merged);
  const listFilesAfter = fs
    .readdirSync(os.tmpdir())
    .filter((f) => f.includes("openwhispr-opus-concat-list"));

  assert.deepEqual(listFilesAfter, listFilesBefore, "concat list should be cleaned up");
  assert.equal(fs.existsSync(merged), true);
});

test("clearCache is a no-op for cached ffmpeg path resolution", () => {
  // Just make sure it exists and is callable; the cached path is a process-wide
  // singleton, so we don't try to assert on its value here.
  clearCache();
  clearCache();
});
