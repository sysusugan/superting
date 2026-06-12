import assert from "node:assert/strict";
import test from "node:test";

import { parseImportedTranscriptTxt } from "../../src/utils/importTranscriptTxt.ts";

test("imported transcript treats 发言者 labels as generic speaker labels", () => {
  const imported = parseImportedTranscriptTxt(
    ["会议记录", "发言者 2 00:01:05", "第二位发言者内容"].join("\n")
  );

  assert.equal(imported.segments.length, 1);
  assert.equal(imported.segments[0].speaker, "speaker_1");
  assert.equal(imported.segments[0].speakerName, undefined);
  assert.equal(imported.segments[0].speakerIsPlaceholder, true);
});

