import assert from "node:assert/strict";
import test from "node:test";

import { getCleanupError, getVoiceFlowMetadata } from "../../src/utils/voiceFlowMetadata.ts";

const makeItem = (processingMetadata: unknown) =>
  ({
    id: 1,
    text: "raw text",
    raw_text: "raw text",
    timestamp: "2026-06-12T00:00:00.000Z",
    created_at: "2026-06-12T00:00:00.000Z",
    processing_metadata:
      typeof processingMetadata === "string"
        ? processingMetadata
        : JSON.stringify(processingMetadata),
  }) as never;

test("voice flow metadata exposes cleanup failure diagnostics", () => {
  const item = makeItem({
    voiceFlow: {
      warning: "cleanup_failed",
      cleanupError: {
        message: "OpenAI API key is missing",
        code: "API_KEY_MISSING",
        provider: "openai",
        model: "gpt-5-mini",
        stage: "cleanup",
      },
    },
  });

  assert.deepEqual(getCleanupError(item), {
    message: "OpenAI API key is missing",
    code: "API_KEY_MISSING",
    provider: "openai",
    model: "gpt-5-mini",
    stage: "cleanup",
  });
  assert.equal(getVoiceFlowMetadata(item)?.cleanupError?.message, "OpenAI API key is missing");
});

test("cleanup failure diagnostics reject malformed payloads", () => {
  const item = makeItem({
    voiceFlow: {
      warning: "cleanup_failed",
      cleanupError: { stack: "secret stack" },
    },
  });

  assert.equal(getCleanupError(item), null);
});
