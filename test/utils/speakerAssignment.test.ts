import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSelectedTranscriptSegments,
  assignSpeakerGroupName,
  filterTranscriptSegmentsBySpeaker,
  getTranscriptSpeakerDisplay,
  getTranscriptSpeakerFilterOptions,
} from "../../src/utils/speakerAssignment.ts";

const labels = { you: "你", speaker: (n: number) => `发言人 ${n}` };

test("manual speaker names override the default self label", () => {
  const display = getTranscriptSpeakerDisplay(
    {
      id: "seg-1",
      text: "hello",
      source: "mic",
      speaker: "you",
      speakerName: "Vicky",
    },
    {},
    labels
  );

  assert.equal(display.label, "Vicky");
  assert.equal(display.isSelf, false);
});

test("selected segment assignment only changes selected segments", () => {
  const segments = [
    { id: "seg-1", text: "first", source: "mic" as const, speaker: "you" },
    { id: "seg-2", text: "second", source: "mic" as const, speaker: "you" },
  ];

  const next = assignSelectedTranscriptSegments(segments, new Set(["seg-1"]), "Vicky");

  assert.equal(next[0].speakerName, "Vicky");
  assert.equal(next[0].speakerLocked, true);
  assert.equal(next[0].speakerLockSource, "user");
  assert.equal(next[1].speakerName, undefined);
  assert.equal(next[1].speakerLocked, undefined);
});

test("speaker group assignment renames every segment with the same speaker id", () => {
  const segments = [
    { id: "seg-1", text: "first", source: "system" as const, speaker: "speaker_0" },
    { id: "seg-2", text: "second", source: "system" as const, speaker: "speaker_1" },
    { id: "seg-3", text: "third", source: "system" as const, speaker: "speaker_0" },
  ];

  const next = assignSpeakerGroupName(segments, "speaker_0", "苏金");

  assert.equal(next[0].speakerName, "苏金");
  assert.equal(next[1].speakerName, undefined);
  assert.equal(next[2].speakerName, "苏金");
  assert.equal(next[0].speakerLocked, true);
  assert.equal(next[2].speakerLockSource, "user");
});

test("speaker filter options are deduped by effective speaker identity", () => {
  const segments = [
    { id: "seg-1", text: "first", source: "mic" as const, speaker: "you" },
    { id: "seg-2", text: "second", source: "system" as const, speaker: "speaker_0" },
    {
      id: "seg-3",
      text: "third",
      source: "system" as const,
      speaker: "speaker_0",
      speakerName: "Vicky",
    },
    { id: "seg-4", text: "fourth", source: "system" as const, speaker: "speaker_1" },
  ];

  const options = getTranscriptSpeakerFilterOptions(segments, { speaker_1: "苏金" }, labels);

  assert.deepEqual(options, [
    { key: "speaker:you", label: "你", colorKey: "you" },
    { key: "speaker:speaker_0", label: "Vicky", colorKey: "speaker_0" },
    { key: "speaker:speaker_1", label: "苏金", colorKey: "speaker_1" },
  ]);
});

test("speaker filter options ignore unresolved provisional placeholder speakers", () => {
  const segments = [
    { id: "seg-1", text: "first", source: "mic" as const, speaker: "you" },
    {
      id: "seg-2",
      text: "second",
      source: "system" as const,
      speaker: "speaker_91",
      speakerIsPlaceholder: true,
      speakerStatus: "provisional" as const,
    },
    {
      id: "seg-3",
      text: "third",
      source: "system" as const,
      speaker: "speaker_0",
      speakerStatus: "confirmed" as const,
    },
  ];

  const options = getTranscriptSpeakerFilterOptions(segments, {}, labels);

  assert.deepEqual(options, [
    { key: "speaker:you", label: "你", colorKey: "you" },
    { key: "speaker:speaker_0", label: "发言人 1", colorKey: "speaker_0" },
  ]);
});

test("speaker filtering only keeps selected effective speakers", () => {
  const segments = [
    { id: "seg-1", text: "first", source: "mic" as const, speaker: "you" },
    { id: "seg-2", text: "second", source: "system" as const, speaker: "speaker_0" },
    { id: "seg-3", text: "third", source: "system" as const, speaker: "speaker_1" },
  ];

  const filtered = filterTranscriptSegmentsBySpeaker(segments, new Set(["speaker:speaker_0"]));
  const none = filterTranscriptSegmentsBySpeaker(segments, new Set());
  const all = filterTranscriptSegmentsBySpeaker(segments, null);

  assert.deepEqual(
    filtered.map((segment) => segment.id),
    ["seg-2"]
  );
  assert.deepEqual(
    none.map((segment) => segment.id),
    []
  );
  assert.deepEqual(
    all.map((segment) => segment.id),
    ["seg-1", "seg-2", "seg-3"]
  );
});
