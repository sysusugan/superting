import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateModelSizeB,
  shouldEnableChatTools,
} from "../../src/components/chat/toolSupportPolicy.ts";

test("custom chat provider enables agent tools", () => {
  assert.equal(
    shouldEnableChatTools({
      isCloudAgent: false,
      chatAgentProvider: "custom",
      chatAgentModel: "deepseek-chat",
    }),
    true
  );
});

test("built-in cloud chat providers enable agent tools", () => {
  for (const provider of ["openai", "groq", "anthropic", "gemini"]) {
    assert.equal(
      shouldEnableChatTools({
        isCloudAgent: false,
        chatAgentProvider: provider,
        chatAgentModel: "provider-model",
      }),
      true,
      provider
    );
  }
});

test("local chat providers require at least 4B parameters for agent tools", () => {
  assert.equal(
    shouldEnableChatTools({
      isCloudAgent: false,
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen2.5-3b-instruct",
    }),
    false
  );

  assert.equal(
    shouldEnableChatTools({
      isCloudAgent: false,
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen2.5-7b-instruct",
    }),
    true
  );
});

test("OpenWhispr cloud agent always enables agent tools", () => {
  assert.equal(
    shouldEnableChatTools({
      isCloudAgent: true,
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen2.5-3b-instruct",
    }),
    true
  );
});

test("model size parser reads parameter count suffixes", () => {
  assert.equal(estimateModelSizeB("qwen2.5-7b-instruct"), 7);
  assert.equal(estimateModelSizeB("model-without-size"), 0);
});
