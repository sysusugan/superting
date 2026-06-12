import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSpeakerGroupName,
  buildTranscriptSpeakerBlocks,
  filterTranscriptSegmentsBySpeaker,
  getTranscriptSpeakerDisplay,
  getTranscriptSpeakerFilterOptions,
} from "../../src/utils/speakerAssignment.ts";

const labels = {
  you: "你",
  speaker: (n: number) => `发言者 ${n}`,
  unknownTrack: "未知音轨",
  unmatchedSpeaker: "未匹配说话人",
};

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

test("final transcript display falls back to a numbered speaker for unresolved mic segments", () => {
  const display = getTranscriptSpeakerDisplay(
    {
      id: "seg-1",
      text: "hello",
      source: "mic",
    },
    {},
    labels,
    { selfFallback: false }
  );

  assert.equal(display.label, "发言者 1");
  assert.equal(display.isSelf, false);
});

test("final transcript display labels unmatched diarization segments explicitly", () => {
  const display = getTranscriptSpeakerDisplay(
    {
      id: "seg-1",
      text: "hello",
      source: "system",
      speakerMatchStatus: "unmatched",
    },
    {},
    labels,
    { selfFallback: false }
  );

  assert.equal(display.label, "未匹配说话人");
  assert.equal(display.isSelf, false);
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
    { key: "speaker:speaker_0", label: "发言者 1", colorKey: "speaker_0" },
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

test("transcript speaker blocks merge adjacent segments from the same effective speaker", () => {
  const segments = [
    { id: "seg-1", text: "第一句", source: "system" as const, speaker: "speaker_0", timestamp: 10 },
    { id: "seg-2", text: "第二句", source: "system" as const, speaker: "speaker_0", timestamp: 15 },
    { id: "seg-3", text: "第三句", source: "system" as const, speaker: "speaker_1", timestamp: 20 },
    { id: "seg-4", text: "第四句", source: "system" as const, speaker: "speaker_0", timestamp: 25 },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, {}, labels);

  assert.deepEqual(
    blocks.map((block) => ({
      id: block.id,
      text: block.text,
      timestamp: block.timestamp,
      segmentIds: block.segments.map((segment) => segment.id),
      speakerLabel: block.speakerDisplay.label,
    })),
    [
      {
        id: "seg-1",
        text: "第一句 第二句",
        timestamp: 10,
        segmentIds: ["seg-1", "seg-2"],
        speakerLabel: "发言者 1",
      },
      {
        id: "seg-3",
        text: "第三句",
        timestamp: 20,
        segmentIds: ["seg-3"],
        speakerLabel: "发言者 2",
      },
      {
        id: "seg-4",
        text: "第四句",
        timestamp: 25,
        segmentIds: ["seg-4"],
        speakerLabel: "发言者 1",
      },
    ]
  );
});

test("transcript speaker blocks split same speaker by maximum block duration", () => {
  const segments = [
    { id: "seg-1", text: "第一段", source: "system" as const, speaker: "speaker_0", timestamp: 0 },
    { id: "seg-2", text: "第二段", source: "system" as const, speaker: "speaker_0", timestamp: 45 },
    { id: "seg-3", text: "第三段", source: "system" as const, speaker: "speaker_0", timestamp: 61 },
    {
      id: "seg-4",
      text: "第四段",
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: 110,
    },
    {
      id: "seg-5",
      text: "第五段",
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: 122,
    },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, {}, labels, {
    maxBlockDurationSeconds: 60,
  });

  assert.deepEqual(
    blocks.map((block) => ({
      text: block.text,
      timestamp: block.timestamp,
      segmentIds: block.segments.map((segment) => segment.id),
    })),
    [
      { text: "第一段 第二段", timestamp: 0, segmentIds: ["seg-1", "seg-2"] },
      { text: "第三段 第四段", timestamp: 61, segmentIds: ["seg-3", "seg-4"] },
      { text: "第五段", timestamp: 122, segmentIds: ["seg-5"] },
    ]
  );
});

test("transcript speaker blocks split a single oversized segment for display", () => {
  const text = [
    "第一部分说明会议背景以及这次讨论的主要目标。",
    "第二部分继续讲企业内部流程以及下一步落地方式。",
    "第三部分补充客户场景和组织协同的细节。",
    "第四部分讨论产品能力以及后续行动安排。",
  ].join("");
  const segments = [
    {
      id: "seg-1",
      text,
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: 18_018,
    },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, {}, labels, {
    maxBlockDurationSeconds: 60,
    maxBlockTextLength: 24,
    timelineDurationSeconds: 300,
  });

  assert.ok(blocks.length > 1);
  assert.deepEqual(
    blocks.map((block) => block.timestamp),
    [18_018, undefined, undefined, undefined]
  );
  assert.ok(blocks.every((block) => block.text.length <= 24));
});

test("transcript speaker blocks do not use later segment timestamps as block start", () => {
  const segments = [
    { id: "seg-1", text: "没有时间的开头", source: "system" as const, speaker: "speaker_0" },
    {
      id: "seg-2",
      text: "后续才有时间",
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: 30,
    },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, {}, labels, {
    maxBlockDurationSeconds: 60,
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].timestamp, undefined);
  assert.deepEqual(
    blocks[0].segments.map((segment) => segment.id),
    ["seg-1", "seg-2"]
  );
});

test("transcript speaker blocks support epoch millisecond timestamps for duration limits", () => {
  const startedAt = 1_781_274_000_000;
  const segments = [
    {
      id: "seg-1",
      text: "第一段",
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: startedAt,
    },
    {
      id: "seg-2",
      text: "第二段",
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: startedAt + 45_000,
    },
    {
      id: "seg-3",
      text: "第三段",
      source: "system" as const,
      speaker: "speaker_0",
      timestamp: startedAt + 61_000,
    },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, {}, labels, {
    maxBlockDurationSeconds: 60,
  });

  assert.deepEqual(
    blocks.map((block) => block.segments.map((segment) => segment.id)),
    [["seg-1", "seg-2"], ["seg-3"]]
  );
});

test("transcript speaker blocks keep speaker changes as boundaries even inside time window", () => {
  const segments = [
    { id: "seg-1", text: "第一句", source: "system" as const, speaker: "speaker_0", timestamp: 0 },
    { id: "seg-2", text: "第二句", source: "system" as const, speaker: "speaker_1", timestamp: 20 },
    { id: "seg-3", text: "第三句", source: "system" as const, speaker: "speaker_0", timestamp: 35 },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, {}, labels, {
    maxBlockDurationSeconds: 60,
  });

  assert.deepEqual(
    blocks.map((block) => block.segments.map((segment) => segment.id)),
    [["seg-1"], ["seg-2"], ["seg-3"]]
  );
});

test("transcript speaker blocks recompute when speaker names change", () => {
  const segments = [
    { id: "seg-1", text: "第一句", source: "system" as const, speaker: "speaker_0" },
    {
      id: "seg-2",
      text: "第二句",
      source: "system" as const,
      speaker: "speaker_1",
      speakerName: "苏金",
    },
  ];

  const before = buildTranscriptSpeakerBlocks(segments, {}, labels);
  const after = buildTranscriptSpeakerBlocks(segments, { speaker_0: "苏金" }, labels);

  assert.deepEqual(
    before.map((block) => block.text),
    ["第一句", "第二句"]
  );
  assert.deepEqual(
    after.map((block) => ({
      text: block.text,
      segmentIds: block.segments.map((segment) => segment.id),
      speakerLabel: block.speakerDisplay.label,
    })),
    [{ text: "第一句 第二句", segmentIds: ["seg-1", "seg-2"], speakerLabel: "苏金" }]
  );
});

test("transcript speaker blocks obey time window after speaker names merge", () => {
  const segments = [
    { id: "seg-1", text: "第一句", source: "system" as const, speaker: "speaker_0", timestamp: 0 },
    {
      id: "seg-2",
      text: "第二句",
      source: "system" as const,
      speaker: "speaker_1",
      speakerName: "苏金",
      timestamp: 30,
    },
    {
      id: "seg-3",
      text: "第三句",
      source: "system" as const,
      speaker: "speaker_1",
      speakerName: "苏金",
      timestamp: 75,
    },
  ];

  const blocks = buildTranscriptSpeakerBlocks(segments, { speaker_0: "苏金" }, labels, {
    maxBlockDurationSeconds: 60,
  });

  assert.deepEqual(
    blocks.map((block) => ({
      text: block.text,
      segmentIds: block.segments.map((segment) => segment.id),
      speakerLabel: block.speakerDisplay.label,
    })),
    [
      { text: "第一句 第二句", segmentIds: ["seg-1", "seg-2"], speakerLabel: "苏金" },
      { text: "第三句", segmentIds: ["seg-3"], speakerLabel: "苏金" },
    ]
  );
});
