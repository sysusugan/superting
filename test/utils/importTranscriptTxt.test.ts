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

test("imported transcript parses speaker labels with bracketed timestamps", () => {
  const imported = parseImportedTranscriptTxt(
    [
      "田文杰(00:00:56): 我。哎哈喽。",
      "",
      "张嫱 (00:01:03)： Hello.",
      "",
      "张嫱(00:01:09): 哦，没有，就我们两个人。",
    ].join("\n")
  );

  assert.equal(imported.title, null);
  assert.equal(imported.segments.length, 3);
  assert.equal(imported.segments[0].speakerName, "田文杰");
  assert.equal(imported.segments[0].speakerIsPlaceholder, false);
  assert.equal(imported.segments[0].speakerLocked, true);
  assert.equal(imported.segments[0].speakerStatus, "locked");
  assert.equal(imported.segments[0].speakerLockSource, "user");
  assert.equal(imported.segments[0].timestamp, 56);
  assert.equal(imported.segments[0].text, "我。哎哈喽。");
  assert.equal(imported.segments[1].speakerName, "张嫱");
  assert.equal(imported.segments[1].timestamp, 63);
  assert.equal(imported.segments[1].text, "Hello.");
  assert.equal(imported.segments[2].speakerName, "张嫱");
  assert.equal(imported.segments[2].timestamp, 69);
  assert.equal(imported.segments[2].text, "哦，没有，就我们两个人。");
});

test("imported transcript parses Tencent meeting text export with minute timestamps", () => {
  const imported = parseImportedTranscriptTxt(
    [
      "2026年6月23日 下午 4:32|46分钟 31秒",
      "",
      "关键词:",
      "素材、脚本、后台",
      "",
      "文字记录:",
      "king 小金 00:00 ",
      "OK，也就是两个维度你们都会用到，对吗？",
      "",
      "香茗 00:05 ",
      "对的。",
      "",
      "说话人 1 09:23 ",
      "你一个个拖进去，是吗？",
    ].join("\n")
  );

  assert.equal(imported.title, "2026年6月23日 下午 4:32|46分钟 31秒");
  assert.equal(imported.segments.length, 3);
  assert.equal(imported.segments[0].speakerName, "king 小金");
  assert.equal(imported.segments[0].timestamp, 0);
  assert.equal(imported.segments[0].text, "OK，也就是两个维度你们都会用到，对吗？");
  assert.equal(imported.segments[1].speakerName, "香茗");
  assert.equal(imported.segments[1].timestamp, 5);
  assert.equal(imported.segments[2].speaker, "speaker_0");
  assert.equal(imported.segments[2].speakerIsPlaceholder, true);
  assert.equal(imported.segments[2].timestamp, 563);
});
