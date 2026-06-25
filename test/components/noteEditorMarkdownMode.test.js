const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/components/notes/NoteEditor.tsx"), "utf8");

test("note editor keeps markdown editing mode independent from content view mode", () => {
  assert.match(source, /import\s+\{\s*MarkdownSourceEditor\s*\}/);
  assert.match(source, /type\s+EditorMode\s*=\s*"rich"\s*\|\s*"markdown"/);
  assert.match(source, /EDITOR_MODE_STORAGE_KEY/);
  assert.doesNotMatch(
    source,
    /type\s+MeetingViewMode\s*=\s*"raw"\s*\|\s*"transcript"\s*\|\s*"enhanced"\s*\|\s*"markdown"/
  );
});
