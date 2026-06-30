const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("note editor drag import supports transcript files outside note edit mode", () => {
  const noteEditor = read("src/components/notes/NoteEditor.tsx");

  assert.match(noteEditor, /const canImportDraggedFile/);
  assert.match(noteEditor, /isSupportedTranscriptImportFileName\(file\.name\)/);
  assert.match(noteEditor, /void importTranscriptFile\(file\)/);
  assert.doesNotMatch(noteEditor, /const handleNoteDragOver[\s\S]*?if \(!canImportNoteFile\) return;/);
});
