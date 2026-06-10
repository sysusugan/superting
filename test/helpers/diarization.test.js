const assert = require("node:assert/strict");
const test = require("node:test");

const DiarizationManager = require("../../src/helpers/diarization.js");
const { MAX_SPEAKER_COUNT } = require("../../src/constants/speakerDetection.json");

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
