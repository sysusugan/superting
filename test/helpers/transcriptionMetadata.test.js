const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSaveTranscriptionInsert } = require("../../src/helpers/database");

test("buildSaveTranscriptionInsert includes dictation metadata columns and values", () => {
  const insert = buildSaveTranscriptionInsert(
    "SuperTing fixed Qdrant.",
    "open whisper fixed q drant",
    {
      clientTranscriptionId: "client-meta-1",
      provider: "superting",
      model: "gpt-4o-mini-transcribe",
      language: "en",
      audioDurationMs: 1234,
      warning: "cleanup_failed",
      partial: true,
      processingMetadata: {
        transcriptionProcessingDurationMs: 320,
        reasoningProcessingDurationMs: 180,
      },
    }
  );

  assert.equal(
    insert.sql,
    "INSERT INTO transcriptions (text, raw_text, status, error_message, error_code, client_transcription_id, provider, model, language, audio_duration_ms, warning, partial, processing_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  assert.deepEqual(insert.values, [
    "SuperTing fixed Qdrant.",
    "open whisper fixed q drant",
    "completed",
    null,
    null,
    "client-meta-1",
    "superting",
    "gpt-4o-mini-transcribe",
    "en",
    1234,
    "cleanup_failed",
    1,
    JSON.stringify({
      transcriptionProcessingDurationMs: 320,
      reasoningProcessingDurationMs: 180,
    }),
  ]);
});
