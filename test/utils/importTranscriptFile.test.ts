import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedTranscriptImportFileName,
  readImportedTranscriptFileText,
} from "../../src/utils/importTranscriptFile.ts";

test("transcript import accepts Word documents", () => {
  assert.equal(isSupportedTranscriptImportFileName("meeting.docx"), true);
  assert.equal(isSupportedTranscriptImportFileName("meeting.pdf"), false);
});

test("transcript import extracts text from Word documents", async () => {
  const file = {
    name: "meeting.docx",
    arrayBuffer: async () => new ArrayBuffer(8),
    text: async () => {
      throw new Error("docx import should not read binary files as text");
    },
  } as unknown as File;

  const text = await readImportedTranscriptFileText(file, async (buffer) => {
    assert.equal(buffer.byteLength, 8);
    return "会议记录\n发言人 1 00:00:00\nWord 文档内容";
  });

  assert.equal(text, "会议记录\n发言人 1 00:00:00\nWord 文档内容");
});
