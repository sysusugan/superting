import assert from "node:assert/strict";
import test from "node:test";

import { buildNoteActionInput } from "../../src/components/notes/noteActionInput.ts";

test("treats any raw transcript as meeting note even without speaker segments", () => {
  const result = buildNoteActionInput({
    noteContent: "",
    rawTranscript: "我们讨论了 Universe 和 Navy",
    speakerLabels: { you: "You", them: "Them" },
  });

  assert.equal(result?.isMeetingNote, true);
  assert.match(result?.content ?? "", /## Meeting Transcript/);
  assert.match(result?.content ?? "", /Universe/);
});

test("formats structured transcript segments with speaker labels", () => {
  const result = buildNoteActionInput({
    noteContent: "manual note",
    rawTranscript: JSON.stringify([
      { source: "mic", text: "我的观点" },
      { source: "system", text: "对方回应" },
    ]),
    speakerLabels: { you: "You", them: "Them" },
  });

  assert.equal(result?.isMeetingNote, true);
  assert.match(result?.content ?? "", /manual note/);
  assert.match(result?.content ?? "", /You: 我的观点/);
  assert.match(result?.content ?? "", /Them: 对方回应/);
});

test("returns null without note content or transcript", () => {
  assert.equal(
    buildNoteActionInput({
      noteContent: "",
      rawTranscript: "",
      speakerLabels: { you: "You", them: "Them" },
    }),
    null
  );
});
