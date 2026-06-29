const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("note editor and list expose note tags", () => {
  const editor = read("src/components/notes/NoteEditor.tsx");
  const listItem = read("src/components/notes/NoteListItem.tsx");
  const notesView = read("src/components/notes/PersonalNotesView.tsx");

  assert.match(editor, /import NoteTagsEditor from "\.\/NoteTagsEditor"/);
  assert.match(editor, /onTagsChange/);
  assert.match(editor, /<NoteTagsEditor/);
  assert.match(listItem, /note\.tags/);
  assert.match(notesView, /selectedTag/);
  assert.match(notesView, /visibleNotes\.map/);
  assert.match(notesView, /notes\.tags\.filterAll/);
});

test("MCP integration renders the tool catalog returned by status", () => {
  const card = read("src/components/McpIntegrationCard.tsx");

  assert.match(card, /tools:\s*Array<\{ name: string \}>/);
  assert.match(card, /status\.tools/);
  assert.match(card, /\(status\.tools \|\| \[\]\)\.map/);
  assert.match(card, /integrations\.mcp\.toolsTitle/);
});
