const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeChineseScript,
} = require("../../src/utils/chineseScriptNormalizationCore.cjs");

test("normalizes Traditional Chinese transcript text to Simplified for zh-CN", () => {
  assert.equal(
    normalizeChineseScript("是說由這個 Agent 去理解了企業的各種", "zh-CN"),
    "是说由这个 Agent 去理解了企业的各种"
  );
});

test("normalizes Simplified Chinese transcript text to Traditional for zh-TW", () => {
  assert.equal(
    normalizeChineseScript("他说由这个 Agent 去理解了企业的各种", "zh-TW"),
    "他說由這個 Agent 去理解了企業的各種"
  );
});

test("leaves auto and non-Chinese languages unchanged", () => {
  assert.equal(normalizeChineseScript("是說由這個 Agent", "auto"), "是說由這個 Agent");
  assert.equal(normalizeChineseScript("是說由這個 Agent", "en"), "是說由這個 Agent");
});
