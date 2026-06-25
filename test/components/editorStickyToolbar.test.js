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
const appStyles = fs.readFileSync(path.join(root, "src/index.css"), "utf8");

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

test("editor toolbar keeps compact vertical spacing and smaller format icons", () => {
  assert.match(appStyles, /\.editor-toolbar\s*\{[\s\S]*gap:\s*0\.25rem;/);
  assert.match(appStyles, /\.editor-toolbar\s*\{[\s\S]*padding:\s*0\.375rem 0\.5rem;/);
  assert.match(appStyles, /\.editor-toolbar-button\s*\{[\s\S]*width:\s*1\.625rem;[\s\S]*height:\s*1\.625rem;/);
  assert.match(appStyles, /\.editor-toolbar-row-format \.editor-toolbar-button\s*\{[\s\S]*width:\s*1\.5rem;[\s\S]*height:\s*1\.5rem;/);
  assert.match(appStyles, /\.editor-toolbar-row-format \.editor-toolbar-button svg\s*\{[\s\S]*width:\s*0\.75rem;[\s\S]*height:\s*0\.75rem;/);
  assert.match(appStyles, /\.editor-toolbar-mode-button\s*\{[\s\S]*font-size:\s*0\.6875rem;/);
});

test("rich editor tables render with a complete visible grid", () => {
  assert.match(appStyles, /\.rich-text-editor-content table\s*\{[\s\S]*border-collapse:\s*collapse;/);
  assert.match(appStyles, /\.rich-text-editor-content table\s*\{[\s\S]*border:\s*1px solid var\(--rich-text-table-border\);/);
  assert.match(
    appStyles,
    /\.rich-text-editor-content th,\s*\n\.rich-text-editor-content td\s*\{[\s\S]*border:\s*1px solid var\(--rich-text-table-border\);/
  );
  assert.doesNotMatch(appStyles, /\.rich-text-editor-content th:last-child/);
  assert.doesNotMatch(appStyles, /\.rich-text-editor-content tr:last-child td/);
});
