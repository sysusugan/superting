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
  validateCompressedAudio,
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

function writeToneWav(
  filePath,
  { sampleRate = 24000, channels = 1, durationSec = 0.5, frequency = 440 } = {}
) {
  const bytesPerSample = 2;
  const numSamples = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(numSamples * channels * bytesPerSample);
  for (let i = 0; i < numSamples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 12000);
    for (let channel = 0; channel < channels; channel += 1) {
      pcm.writeInt16LE(value, (i * channels + channel) * bytesPerSample);
    }
  }
  writeWavWithPcm(filePath, pcm, { sampleRate, channels });
}

function writeWavWithPcm(filePath, pcm, { sampleRate = 24000, channels = 1 } = {}) {
  const bytesPerSample = 2;
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
  writeToneWav(input, { durationSec: 2 });
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

test("compressToOpusWebm preserves audible WAV content", async (t) => {
  const dir = makeTempDir(t);
  const input = path.join(dir, "tone.wav");
  const output = path.join(dir, "tone.webm");
  writeToneWav(input, { durationSec: 1 });

  const validation = await compressToOpusWebm(input, output);

  assert.equal(fs.existsSync(output), true);
  assert.ok(validation.input.maxVolumeDb > -20, `input max ${validation.input.maxVolumeDb}`);
  assert.ok(validation.output.maxVolumeDb > -25, `output max ${validation.output.maxVolumeDb}`);
});

test("validateCompressedAudio rejects audible input compressed to silence", async (t) => {
  const dir = makeTempDir(t);
  const input = path.join(dir, "tone.wav");
  const output = path.join(dir, "silent.wav");
  writeToneWav(input, { durationSec: 1 });
  writeWav(output, { durationSec: 1 });

  await assert.rejects(
    () => validateCompressedAudio(input, output),
    /compressed audio is silent/
  );
});

test("compressToOpusWebm removes temp output when validation fails", async (t) => {
  const dir = makeTempDir(t);
  const input = path.join(dir, "tone.wav");
  const output = path.join(dir, "tone.webm");
  writeToneWav(input, { durationSec: 1 });
  const tempFilesBefore = fs
    .readdirSync(os.tmpdir())
    .filter((f) => f.includes("openwhispr-opus-compress"));

  await assert.rejects(
    () =>
      compressToOpusWebm(input, output, {
        audibleThresholdDb: -90,
        silentOutputThresholdDb: 0,
      }),
    /compressed audio is silent/
  );

  const tempFilesAfter = fs
    .readdirSync(os.tmpdir())
    .filter((f) => f.includes("openwhispr-opus-compress"));
  assert.deepEqual(tempFilesAfter, tempFilesBefore);
  assert.equal(fs.existsSync(output), false);
});

test("validateCompressedAudio rejects large duration drift", async (t) => {
  const dir = makeTempDir(t);
  const input = path.join(dir, "long.wav");
  const output = path.join(dir, "short.wav");
  writeToneWav(input, { durationSec: 2 });
  writeToneWav(output, { durationSec: 0.25 });

  await assert.rejects(
    () => validateCompressedAudio(input, output),
    /duration differs/
  );
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
