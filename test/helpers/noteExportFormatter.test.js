const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSelectedNoteExport,
  normalizeExportOptions,
  safeExportBaseName,
  uniqueExportPath,
} = require("../../src/helpers/noteExportFormatter");

function makeNote(overrides = {}) {
  return {
    id: 42,
    title: "Planning / Notes",
    content: "# Raw note\n\nHello **world**.",
    enhanced_content: "## Summary\n\nBetter _content_.",
    transcript: JSON.stringify([
      { id: "a", speaker: "you", timestamp: 0, text: "First line" },
      { id: "b", speaker: "speaker_1", timestamp: 65, text: "Second line" },
    ]),
    created_at: "2026-05-31T10:30:00.000Z",
    ...overrides,
  };
}

test("buildSelectedNoteExport writes selected fields as markdown sections", () => {
  const output = buildSelectedNoteExport(makeNote(), {
    format: "md",
    fields: ["transcript", "content"],
  });

  assert.match(output, /^# Planning \/ Notes/);
  assert.match(output, /## Transcription/);
  assert.match(output, /You `00:00:00`: First line/);
  assert.match(output, /Speaker 2 `00:01:05`: Second line/);
  assert.match(output, /## Notes/);
  assert.match(output, /# Raw note/);
  assert.doesNotMatch(output, /## Enhanced Content/);
});

test("buildSelectedNoteExport strips markdown for text exports", () => {
  const output = buildSelectedNoteExport(makeNote(), {
    format: "txt",
    fields: ["content", "enhanced_content"],
  });

  assert.match(output, /^Planning \/ Notes/);
  assert.match(output, /NOTES\nRaw note\n\nHello world\./);
  assert.match(output, /ENHANCED CONTENT\nSummary\n\nBetter content\./);
});

test("buildSelectedNoteExport keeps empty field headings", () => {
  const output = buildSelectedNoteExport(makeNote({ enhanced_content: null, transcript: null }), {
    format: "md",
    fields: ["transcript", "enhanced_content"],
  });

  assert.match(output, /## Transcription\n\n## Enhanced Content/);
});

test("buildSelectedNoteExport tolerates invalid transcript JSON", () => {
  const output = buildSelectedNoteExport(makeNote({ transcript: "{not json" }), {
    format: "txt",
    fields: ["transcript"],
  });

  assert.match(output, /TRANSCRIPTION\n$/);
});

test("normalizeExportOptions filters unsupported fields and formats", () => {
  assert.deepEqual(
    normalizeExportOptions({
      format: "pdf",
      fields: ["content", "bad", "transcript"],
    }),
    { format: "md", fields: ["content", "transcript"] }
  );
});

test("safeExportBaseName removes path-unsafe characters and includes note id", () => {
  assert.equal(safeExportBaseName(makeNote()), "Planning - Notes-42");
});

test("uniqueExportPath avoids overwriting existing files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-export-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "Planning-42.md"), "existing");

  assert.equal(uniqueExportPath(root, "Planning-42", "md"), path.join(root, "Planning-42-2.md"));
});
