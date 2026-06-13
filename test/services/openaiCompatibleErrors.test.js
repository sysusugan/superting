const assert = require("node:assert/strict");
const test = require("node:test");

const { formatOpenAiCompatibleError } = require("../../src/services/ai/openaiCompatibleErrors");

test("custom provider auth errors mention custom provider credentials", () => {
  const message = formatOpenAiCompatibleError({
    status: 401,
    fallbackMessage: "OpenAI API error: 401",
    isCustomProvider: true,
  });

  assert.match(message, /Custom provider authentication failed/);
  assert.match(message, /API key/);
});

test("non-custom provider errors keep provider response message", () => {
  const message = formatOpenAiCompatibleError({
    status: 401,
    fallbackMessage: "Incorrect API key provided",
    isCustomProvider: false,
  });

  assert.equal(message, "Incorrect API key provided");
});
