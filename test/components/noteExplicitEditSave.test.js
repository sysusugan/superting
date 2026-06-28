const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const noteEditorSource = fs.readFileSync(
  path.join(root, "src/components/notes/NoteEditor.tsx"),
  "utf8"
);
const richTextSource = fs.readFileSync(
  path.join(root, "src/components/ui/RichTextEditor.tsx"),
  "utf8"
);
const noteStoreSource = fs.readFileSync(path.join(root, "src/stores/noteStore.ts"), "utf8");
const ipcSource = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");

test("note content starts read-only and only edited drafts save upstream", () => {
  assert.match(noteEditorSource, /type\s+ContentEditTarget\s*=\s*"raw"\s*\|\s*"enhanced"/);
  assert.match(noteEditorSource, /const\s+\[contentEditTarget,\s*setContentEditTarget\]/);
  assert.match(noteEditorSource, /const\s+\[contentDraft,\s*setContentDraft\]/);
  assert.match(noteEditorSource, /const\s+\[enhancedDraft,\s*setEnhancedDraft\]/);
  assert.match(noteEditorSource, /const\s+handleContentChange[\s\S]*setContentDraft\(newValue\);/);
  assert.doesNotMatch(noteEditorSource, /const\s+handleContentChange[\s\S]*onContentChange\(newValue\);/);
  assert.match(noteEditorSource, /const\s+saveContentDraft[\s\S]*onContentChange\(contentDraft\);/);
  assert.match(noteEditorSource, /const\s+saveContentDraft[\s\S]*enhancement\.onChange\(enhancedDraft\);/);
  assert.match(noteEditorSource, /<RichTextEditor[\s\S]*value=\{note\.content\}[\s\S]*readOnly/);
  assert.match(noteEditorSource, /<RichTextEditor[\s\S]*value=\{enhancement\.content\}[\s\S]*readOnly/);
});

test("leaving content edit prompts through a shared active note guard", () => {
  assert.match(noteStoreSource, /type\s+ActiveNoteChangeGuard/);
  assert.match(noteStoreSource, /export function setActiveNoteChangeGuard/);
  assert.match(noteStoreSource, /if \(activeNoteChangeGuard && !activeNoteChangeGuard\(id, currentId\)\) return;/);
  assert.match(noteEditorSource, /setActiveNoteChangeGuard\(\(nextId, currentId\) =>/);
  assert.match(noteEditorSource, /return confirmSaveContentDraft\(\);/);
  assert.match(noteEditorSource, /beforeunload/);
});

test("note switch autofocus does not steal focus from title editing", () => {
  assert.match(noteEditorSource, /function\s+shouldAutoFocusContentEditor/);
  assert.match(noteEditorSource, /titleElement\.contains\(activeElement\)/);
  assert.match(noteEditorSource, /activeElement\.closest\(\s*"[^\"]*contenteditable/);
  assert.match(noteEditorSource, /if\s+\(shouldAutoFocusContentEditor\([^)]*\)\)\s*\{\s*editorRef\.current\?\.commands\.focus\(\);/);
});

test("document import converts into a draft instead of writing the note immediately", () => {
  assert.match(ipcSource, /options = \{\}/);
  assert.match(ipcSource, /options\?\.dryRun/);
  assert.match(ipcSource, /content:\s*imported\.content/);
  assert.match(noteEditorSource, /importNoteFile\?\.\(note\.id, filePath, \{\s*dryRun:\s*true,\s*\}\)/);
  assert.match(noteEditorSource, /setContentDraft\(result\.imported\.content\);/);
  assert.match(noteEditorSource, /setEnhancedDraft\(result\.imported\.content\);/);
});

test("rich text editor disables editing commands when read-only", () => {
  assert.match(richTextSource, /readOnly\?:\s*boolean/);
  assert.match(richTextSource, /editable:\s*!disabled && !readOnly/);
  assert.match(richTextSource, /editor\.setEditable\(!disabled && !readOnly\)/);
  assert.match(richTextSource, /disabled \|\| readOnly/);
  assert.match(richTextSource, /const canEditTable = [\s\S]*!readOnly/);
});

test("rich text editor does not mark initial markdown normalization as a user edit", () => {
  assert.match(richTextSource, /const\s+userEditPendingRef\s*=\s*useRef\(false\);/);
  assert.match(richTextSource, /const\s+markUserEditPending\s*=\s*useCallback/);
  assert.match(richTextSource, /if \(!userEditPendingRef\.current\)/);
  assert.match(richTextSource, /userEditPendingRef\.current\s*=\s*false;\s*\n\s*onChange\?\.\(md\);/);
  assert.match(richTextSource, /handleDOMEvents:\s*\{\s*beforeinput:/);
  assert.match(richTextSource, /markUserEditPending\(\);\s*\n\s*chain\?\.\[command\]\?/);
  assert.match(richTextSource, /markUserEditPending\(\);\s*\n\s*tableCommands\?\.\[command\]\?/);
  assert.doesNotMatch(richTextSource, /const\s+canUndoUpdate\s*=/);
});
