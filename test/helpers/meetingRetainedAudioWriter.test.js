const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MeetingRetainedAudioWriter = require("../../src/helpers/meetingRetainedAudioWriter");

function buildTonePcm({
  sampleRate = 24000,
  durationSec = 1,
  frequency = 440,
  amplitude = 12000,
} = {}) {
  const sampleCount = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude);
    pcm.writeInt16LE(value, i * 2);
  }
  return pcm;
}

function readPeak(pcmPath) {
  const pcm = fs.readFileSync(pcmPath);
  let peak = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const abs = Math.abs(pcm.readInt16LE(offset));
    if (abs > peak) peak = abs;
  }
  return peak;
}

test("finalize keeps audible mic-only retained audio", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-meeting-retained-"));
  const writer = new MeetingRetainedAudioWriter({ tmpDir: root });
  t.after(async () => {
    await writer.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  writer.writeChunk("mic", buildTonePcm(), 1000);
  const result = await writer.finalize({ requireAudible: true });

  assert.equal(result.success, true);
  assert.equal(result.sourceMix, "mic");
  assert.ok(readPeak(result.pcmPath) > 1000);
  assert.ok(result.durationSeconds > 0.99 && result.durationSeconds < 1.01);
});

test("finalize keeps audible system-only retained audio", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-meeting-retained-"));
  const writer = new MeetingRetainedAudioWriter({ tmpDir: root });
  t.after(async () => {
    await writer.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  writer.writeChunk("system", buildTonePcm({ frequency: 880 }), 1000);
  const result = await writer.finalize({ requireAudible: true });

  assert.equal(result.success, true);
  assert.equal(result.sourceMix, "system");
  assert.ok(readPeak(result.pcmPath) > 1000);
});

test("finalize mixes audible mic and system retained audio", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-meeting-retained-"));
  const writer = new MeetingRetainedAudioWriter({ tmpDir: root });
  t.after(async () => {
    await writer.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  writer.writeChunk("mic", buildTonePcm({ frequency: 440 }), 1000);
  writer.writeChunk("system", buildTonePcm({ frequency: 880 }), 1000);
  const result = await writer.finalize({ requireAudible: true });

  assert.equal(result.success, true);
  assert.equal(result.sourceMix, "mixed");
  assert.ok(readPeak(result.pcmPath) > 1000);
  assert.ok(result.durationSeconds > 0.99 && result.durationSeconds < 1.01);
});

test("finalize falls back to audible mic when system is silent", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-meeting-retained-"));
  const writer = new MeetingRetainedAudioWriter({ tmpDir: root });
  t.after(async () => {
    await writer.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  writer.writeChunk("mic", buildTonePcm({ frequency: 440 }), 1000);
  writer.writeChunk("system", Buffer.alloc(48000), 1000);
  const result = await writer.finalize({ requireAudible: true });

  assert.equal(result.success, true);
  assert.equal(result.sourceMix, "mic");
  assert.ok(readPeak(result.pcmPath) > 1000);
});

test("finalize rejects all-zero retained audio when audible transcript exists", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-meeting-retained-"));
  const writer = new MeetingRetainedAudioWriter({ tmpDir: root });
  t.after(async () => {
    await writer.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  writer.writeChunk("mic", Buffer.alloc(48000), 1000);
  const result = await writer.finalize({ requireAudible: true });

  assert.equal(result.success, false);
  assert.match(result.error, /No audible meeting audio/);
});

test("finalize aligns source start times before mixing", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-meeting-retained-"));
  const writer = new MeetingRetainedAudioWriter({ tmpDir: root });
  t.after(async () => {
    await writer.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  writer.writeChunk("mic", buildTonePcm({ durationSec: 1 }), 1000);
  writer.writeChunk("system", buildTonePcm({ durationSec: 1, frequency: 880 }), 1500);
  const result = await writer.finalize({ requireAudible: true });

  assert.equal(result.success, true);
  assert.equal(result.sourceMix, "mixed");
  assert.ok(result.durationSeconds > 1.49 && result.durationSeconds < 1.51);
});
