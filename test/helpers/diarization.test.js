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
