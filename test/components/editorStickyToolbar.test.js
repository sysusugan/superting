const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const richTextSource = fs.readFileSync(
  path.join(root, "src/components/ui/RichTextEditor.tsx"),
  "utf8"
);
const markdownSource = fs.readFileSync(
  path.join(root, "src/components/ui/MarkdownSourceEditor.tsx"),
  "utf8"
);
const noteEditorSource = fs.readFileSync(
  path.join(root, "src/components/notes/NoteEditor.tsx"),
  "utf8"
);

test("notes editors render a shared sticky top toolbar", () => {
  const toolbarSource = fs.readFileSync(
    path.join(root, "src/components/ui/EditorToolbar.tsx"),
    "utf8"
  );

  assert.match(toolbarSource, /export\s+function\s+EditorToolbar/);
  assert.match(toolbarSource, /mode:\s*EditorToolbarMode/);
  assert.match(toolbarSource, /position\?:\s*"rich"\s*\|\s*"markdown"/);
  assert.match(richTextSource, /<EditorToolbar[\s\S]*mode="rich"/);
  assert.match(markdownSource, /<EditorToolbar[\s\S]*mode="markdown"/);
});

test("note editor passes mode switching and document import into note editors", () => {
  assert.match(noteEditorSource, /onEditorModeChange=\{setEditorMode\}/);
  assert.match(noteEditorSource, /onImportFile=\{\(\)\s*=>\s*openImportFilePicker\("note"\)\}/);
  assert.doesNotMatch(
    noteEditorSource,
    /viewMode !== "transcript" && \(\s*<div className="ow-segmented[\s\S]*notes\.editor\.markdownSource/
  );
});

test("rich toolbar exposes markdown-compatible formatting and table controls", () => {
  for (const command of [
    "toggleBold",
    "toggleItalic",
    "toggleUnderline",
    "toggleStrike",
    "toggleCode",
    "toggleHeading",
    "toggleBulletList",
    "toggleOrderedList",
    "toggleTaskList",
    "toggleBlockquote",
    "toggleCodeBlock",
    "setHorizontalRule",
    "insertTable",
    "deleteTable",
  ]) {
    assert.match(richTextSource, new RegExp(`[".]${command}`), `missing ${command} command`);
  }
});
