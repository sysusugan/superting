const assert = require("node:assert/strict");
const test = require("node:test");

const DiarizationManager = require("../../src/helpers/diarization.js");
const { MAX_SPEAKER_COUNT } = require("../../src/constants/speakerDetection.json");

class TestDiarizationManager extends DiarizationManager {
  constructor({ analyses = [], diarizeResults = [] } = {}) {
    super();
    this.analyses = analyses;
    this.diarizeResults = diarizeResults;
    this.diarizeCalls = [];
    this.extractedWindows = [];
    this.normalizedAudio = [];
    this.tempIndex = 0;
  }

  async _analyzeAudioFile() {
    return this.analyses.shift();
  }

  async _extractAudioWindowToWav(_inputPath, outputPath, options) {
    this.extractedWindows.push({ outputPath, options });
  }

  async _normalizeAudioPeak(inputPath, outputPath, options) {
    this.normalizedAudio.push({ inputPath, outputPath, options });
  }

  _makeAdaptiveTempPath(label) {
    this.tempIndex += 1;
    return `/tmp/${label}-${this.tempIndex}.wav`;
  }

  _cleanupAdaptiveTempPath() {}

  async diarize(wavPath, options = {}) {
    this.diarizeCalls.push({ wavPath, options });
    return this.diarizeResults.shift() || [];
  }
}

test("_buildDiarizationArgs uses configurable diarization thresholds", () => {
  const manager = new DiarizationManager();
  const args = manager._buildDiarizationArgs("/tmp/input.wav", {
    numSpeakers: 2,
    threshold: 0.5,
    minDurationOn: 0.12,
    minDurationOff: 0.35,
  });

  assert.ok(args.includes("--clustering.num-clusters=2"));
  assert.ok(args.includes("--clustering.cluster-threshold=0.5"));
  assert.ok(args.includes("--min-duration-on=0.12"));
  assert.ok(args.includes("--min-duration-off=0.35"));
});

test("diarizeAdaptive skips silent audio without spawning diarization", async () => {
  const manager = new TestDiarizationManager({
    analyses: [
      {
        durationSeconds: 120,
        meanVolumeDb: -90,
        maxVolumeDb: -80,
        activeRatio: 0,
        silenceRatio: 1,
      },
    ],
  });

  const result = await manager.diarizeAdaptive("/tmp/silent.wav");

  assert.deepEqual(result.segments, []);
  assert.equal(manager.diarizeCalls.length, 0);
  assert.equal(result.diagnostics.mode, "single");
  assert.equal(result.diagnostics.windows[0].profile, "silent");
  assert.equal(result.diagnostics.windows[0].skipped, true);
});

test("diarizeAdaptive retries low signal audio with temporary peak normalization", async () => {
  const manager = new TestDiarizationManager({
    analyses: [
      {
        durationSeconds: 120,
        meanVolumeDb: -62,
        maxVolumeDb: -28,
        activeRatio: 0.12,
        silenceRatio: 0.88,
      },
    ],
    diarizeResults: [[], [{ start: 1, end: 2, speaker: "speaker_0" }]],
  });

  const result = await manager.diarizeAdaptive("/tmp/quiet.wav");

  assert.deepEqual(result.segments, [{ start: 1, end: 2, speaker: "speaker_0" }]);
  assert.equal(manager.diarizeCalls.length, 2);
  assert.equal(manager.normalizedAudio.length, 1);
  assert.equal(result.diagnostics.windows[0].profile, "low_signal");
  assert.equal(result.diagnostics.windows[0].retriedWithGain, true);
});

test("diarizeAdaptive windows long audio and offsets successful window segments", async () => {
  const manager = new TestDiarizationManager({
    analyses: [
      { durationSeconds: 720, meanVolumeDb: -40, maxVolumeDb: -6, activeRatio: 0.6 },
      { durationSeconds: 300, meanVolumeDb: -90, maxVolumeDb: -80, activeRatio: 0 },
      { durationSeconds: 300, meanVolumeDb: -40, maxVolumeDb: -6, activeRatio: 0.6 },
      { durationSeconds: 180, meanVolumeDb: -40, maxVolumeDb: -6, activeRatio: 0.6 },
    ],
    diarizeResults: [
      [{ start: 10, end: 20, speaker: "speaker_0" }],
      [{ start: 30, end: 40, speaker: "speaker_1" }],
    ],
  });

  const result = await manager.diarizeAdaptive("/tmp/long.wav");

  assert.deepEqual(result.segments, [
    { start: 280, end: 290, speaker: "speaker_0" },
    { start: 570, end: 580, speaker: "speaker_1" },
  ]);
  assert.equal(manager.extractedWindows.length, 3);
  assert.equal(result.diagnostics.mode, "windowed");
  assert.equal(result.diagnostics.windowCount, 3);
});

test("mergeWithTranscript caps diarization speakers before exposing transcript speakers", () => {
  const manager = new DiarizationManager();
  const transcriptSegments = Array.from({ length: 12 }, (_, index) => ({
    id: `seg-${index}`,
    text: `text ${index}`,
    source: "system",
    timestamp: index * 3,
  }));
  const diarizationSegments = Array.from({ length: 12 }, (_, index) => ({
    start: index * 3,
    end: index * 3 + 2,
    speaker: `speaker_${index}`,
  }));

  const merged = manager.mergeWithTranscript(transcriptSegments, diarizationSegments);
  const speakers = new Set(merged.map((segment) => segment.speaker).filter(Boolean));

  assert.equal(speakers.size, MAX_SPEAKER_COUNT);
  assert.deepEqual([...speakers].sort(), [
    "speaker_0",
    "speaker_1",
    "speaker_2",
    "speaker_3",
    "speaker_4",
    "speaker_5",
    "speaker_6",
    "speaker_7",
  ]);
});

test("mergeWithTranscript filters empty fragments and merges adjacent same-speaker segments", () => {
  const manager = new DiarizationManager();
  const merged = manager.mergeWithTranscript(
    [
      { text: " first ", source: "system", timestamp: 0, endTime: 1 },
      { text: "piece", source: "system", timestamp: 1.4, endTime: 2 },
      { text: " ", source: "system", timestamp: 2.2, endTime: 2.3 },
      { text: "x", source: "system", timestamp: 3, endTime: 3.1 },
      { text: "second speaker", source: "system", timestamp: 5, endTime: 6 },
    ],
    [
      { start: 0, end: 3, speaker: "speaker_0" },
      { start: 4.5, end: 6.5, speaker: "speaker_1" },
    ]
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "first piece");
  assert.equal(merged[0].speaker, "speaker_0");
  assert.equal(merged[1].text, "second speaker");
  assert.equal(merged[1].speaker, "speaker_1");
});

test("mergeWithTranscript keeps mic segments as self by default", () => {
  const manager = new DiarizationManager();
  const merged = manager.mergeWithTranscript(
    [{ text: "mic speech", source: "mic", timestamp: 0, speaker: "you" }],
    [{ start: 0, end: 2, speaker: "external_0" }]
  );

  assert.equal(merged[0].speaker, "you");
});

test("mergeWithTranscript can assign mic-only saved notes from diarization", () => {
  const manager = new DiarizationManager();
  const merged = manager.mergeWithTranscript(
    [
      { text: "first person", source: "mic", timestamp: 0, speaker: "you" },
      { text: "second person", source: "mic", timestamp: 3, speaker: "you" },
    ],
    [
      { start: 0, end: 2, speaker: "external_0" },
      { start: 3, end: 5, speaker: "external_1" },
    ],
    { assignMicSegments: true }
  );

  assert.deepEqual(
    merged.map((segment) => segment.speaker),
    ["speaker_0", "speaker_1"]
  );
  assert.deepEqual(
    merged.map((segment) => segment.source),
    ["system", "system"]
  );
});

test("mergeWithTranscript can consume already stabilized diarization without collapsing speakers again", () => {
  const manager = new DiarizationManager();
  const merged = manager.mergeWithTranscript(
    [
      { text: "speaker zero", source: "system", timestamp: 0 },
      { text: "speaker one", source: "system", timestamp: 5 },
      { text: "speaker two", source: "system", timestamp: 10 },
    ],
    [
      { start: 0, end: 1, speaker: "external_0" },
      { start: 5, end: 6, speaker: "external_1" },
      { start: 10, end: 11, speaker: "external_2" },
    ],
    { diarizationAlreadyStabilized: true }
  );

  assert.deepEqual(
    merged.map((segment) => segment.speaker),
    ["speaker_0", "speaker_1", "speaker_2"]
  );
});

test("mergeWithTranscript returns diarization match diagnostics when requested", () => {
  const manager = new DiarizationManager();
  const result = manager.mergeWithTranscript(
    [
      { id: "seg-1", text: "first", source: "system", timestamp: 0, endTime: 1 },
      { id: "seg-2", text: "second", source: "system", timestamp: 2, endTime: 3 },
    ],
    [
      { start: 0, end: 1.5, speaker: "external_0" },
      { start: 2, end: 3.5, speaker: "external_1" },
    ],
    { includeDiagnostics: true, diarizationAlreadyStabilized: true }
  );

  assert.deepEqual(
    result.segments.map((segment) => segment.speaker),
    ["speaker_0", "speaker_1"]
  );
  assert.equal(result.diagnostics.diarizationSegmentCount, 2);
  assert.equal(result.diagnostics.speakerCount, 2);
  assert.equal(result.diagnostics.matchedSegmentCount, 2);
  assert.equal(result.diagnostics.fallbackMatchedSegmentCount, 0);
  assert.equal(result.diagnostics.unmatchedSegmentCount, 0);
  assert.equal(result.diagnostics.missingTimestampCount, 0);
});

test("mergeWithTranscript counts missing timestamps as unmatched without assigning fake speakers", () => {
  const manager = new DiarizationManager();
  const result = manager.mergeWithTranscript(
    [{ id: "seg-1", text: "no timestamp", source: "system" }],
    [{ start: 0, end: 5, speaker: "external_0" }],
    { includeDiagnostics: true, diarizationAlreadyStabilized: true }
  );

  assert.equal(result.segments[0].speaker, undefined);
  assert.equal(result.segments[0].speakerMatchStatus, "unmatched");
  assert.equal(result.diagnostics.matchedSegmentCount, 0);
  assert.equal(result.diagnostics.unmatchedSegmentCount, 1);
  assert.equal(result.diagnostics.missingTimestampCount, 1);
});

test("mergeWithTranscript falls back to nearest diarization segment when overlap is zero", () => {
  const manager = new DiarizationManager();
  const result = manager.mergeWithTranscript(
    [{ id: "seg-1", text: "near speaker", source: "system", timestamp: 5, endTime: 5.5 }],
    [{ start: 7, end: 8, speaker: "external_0" }],
    { includeDiagnostics: true, diarizationAlreadyStabilized: true }
  );

  assert.equal(result.segments[0].speaker, "speaker_0");
  assert.equal(result.segments[0].speakerMatchMethod, "nearest");
  assert.equal(result.diagnostics.matchedSegmentCount, 1);
  assert.equal(result.diagnostics.fallbackMatchedSegmentCount, 1);
  assert.equal(result.diagnostics.unmatchedSegmentCount, 0);
});

test("mergeWithTranscript does not overwrite user locked speaker assignments", () => {
  const manager = new DiarizationManager();
  const result = manager.mergeWithTranscript(
    [
      {
        id: "seg-1",
        text: "locked",
        source: "system",
        timestamp: 0,
        speaker: "manual_1",
        speakerName: "Alice",
        speakerLocked: true,
        speakerLockSource: "user",
      },
    ],
    [{ start: 0, end: 3, speaker: "external_0" }],
    { includeDiagnostics: true, diarizationAlreadyStabilized: true }
  );

  assert.equal(result.segments[0].speaker, "manual_1");
  assert.equal(result.segments[0].speakerName, "Alice");
  assert.equal(result.diagnostics.lockedSegmentCount, 1);
  assert.equal(result.diagnostics.matchedSegmentCount, 0);
  assert.equal(result.diagnostics.unmatchedSegmentCount, 0);
});

test("stabilizeSpeakerClusters merges isolated short speakers into the nearest stable speaker", () => {
  const manager = new DiarizationManager();
  const stabilized = manager.stabilizeSpeakerClusters([
    { start: 0, end: 4, speaker: "speaker_0" },
    { start: 4.1, end: 4.6, speaker: "speaker_9" },
    { start: 5, end: 9, speaker: "speaker_1" },
  ]);

  assert.deepEqual(stabilized, [
    { start: 0, end: 4, speaker: "speaker_0" },
    { start: 4.1, end: 4.6, speaker: "speaker_0" },
    { start: 5, end: 9, speaker: "speaker_1" },
  ]);
});

test("stabilizeSpeakerClusters applies a hard cap after noise merging", () => {
  const manager = new DiarizationManager();
  const stabilized = manager.stabilizeSpeakerClusters(
    [
      { start: 0, end: 4, speaker: "speaker_0" },
      { start: 5, end: 9, speaker: "speaker_1" },
      { start: 10, end: 14, speaker: "speaker_2" },
    ],
    { cap: 2 }
  );
  const speakers = new Set(stabilized.map((segment) => segment.speaker));

  assert.equal(speakers.size, 2);
});
