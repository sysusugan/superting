const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildNoteExport,
  buildSelectedNoteExport,
  getFieldValue,
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

test("getFieldValue returns explicit note fields without fallback", () => {
  const note = makeNote({ enhanced_content: "" });

  assert.equal(getFieldValue(note, "content", "md"), "# Raw note\n\nHello **world**.");
  assert.equal(getFieldValue(note, "enhanced_content", "md"), "");
});

test("buildNoteExport can export a single content field without title wrapper", () => {
  const output = buildNoteExport(makeNote(), {
    format: "md",
    fields: ["content"],
    includeTitle: false,
  });

  assert.equal(output, "# Raw note\n\nHello **world**.\n");
});

test("buildNoteExport can export a single enhanced field without falling back to content", () => {
  const output = buildNoteExport(makeNote({ enhanced_content: "" }), {
    format: "md",
    fields: ["enhanced_content"],
    includeTitle: false,
  });

  assert.equal(output, "\n");
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
    { format: "pdf", fields: ["content", "transcript"] }
  );
});

test("buildNoteExport keeps markdown field structure for pdf input", () => {
  const output = buildNoteExport(makeNote(), {
    format: "md",
    fields: ["content", "enhanced_content"],
  });

  assert.match(output, /^# Planning \/ Notes/);
  assert.match(output, /## Notes\n\n# Raw note/);
  assert.match(output, /## Enhanced Content\n\n## Summary/);
});

test("safeExportBaseName removes path-unsafe characters and includes note id", () => {
  assert.equal(safeExportBaseName(makeNote()), "Planning - Notes-42");
});

test("uniqueExportPath avoids overwriting existing files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-export-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "Planning-42.md"), "existing");

  assert.equal(uniqueExportPath(root, "Planning-42", "md"), path.join(root, "Planning-42-2.md"));
});
