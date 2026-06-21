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

test("imported transcript parses speaker labels with inline text after timestamps", () => {
  const imported = parseImportedTranscriptTxt(
    [
      "文字记录：企业AI系统功能及应用分享 2026年6月18日",
      "",
      "说话人 1 00:00:00在外围我们就每个人都跟大脑交互。",
      "",
      "说话人 2 00:09:44嗯，其实这一块的话，我感觉功能层面还是比较完善的。",
    ].join("\n")
  );

  assert.equal(imported.segments.length, 2);
  assert.equal(imported.segments[0].speaker, "speaker_0");
  assert.equal(imported.segments[0].speakerName, undefined);
  assert.equal(imported.segments[0].speakerIsPlaceholder, true);
  assert.equal(imported.segments[0].timestamp, 0);
  assert.equal(imported.segments[0].text, "在外围我们就每个人都跟大脑交互。");
  assert.equal(imported.segments[1].speaker, "speaker_1");
  assert.equal(imported.segments[1].timestamp, 584);
  assert.equal(imported.segments[1].text, "嗯，其实这一块的话，我感觉功能层面还是比较完善的。");
});
