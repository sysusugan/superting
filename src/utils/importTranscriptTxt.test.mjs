import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseImportedTranscriptTxt } from "./importTranscriptTxt.ts";

describe("parseImportedTranscriptTxt", () => {
  it("parses speaker headers, timestamps, and text blocks", () => {
    const imported = parseImportedTranscriptTxt(`06-03 内部会议_ AI生成PPT与视频方案的批量应用

发言人 1  00:00:00
我们按照成本来算。

苏淦  00:00:15
报，这项目多少钱？

发言人 4  00:01:05
这个可以继续推进。`);

    assert.equal(imported.title, "06-03 内部会议_ AI生成PPT与视频方案的批量应用");
    assert.equal(imported.segments.length, 3);
    assert.equal(imported.segments[0].speaker, "speaker_0");
    assert.equal(imported.segments[0].timestamp, 0);
    assert.equal(imported.segments[1].speakerName, "苏淦");
    assert.equal(imported.segments[1].speakerLocked, true);
    assert.equal(imported.segments[1].speakerStatus, "locked");
    assert.equal(imported.segments[1].timestamp, 15);
    assert.equal(imported.segments[2].speaker, "speaker_3");
    assert.equal(imported.segments[2].timestamp, 65);
  });
});
