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
    timestamp: index,
  }));
  const diarizationSegments = Array.from({ length: 12 }, (_, index) => ({
    start: index,
    end: index + 0.8,
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
