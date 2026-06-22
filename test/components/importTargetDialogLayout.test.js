const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/components/notes/NoteEditor.tsx"), "utf8");

const importTargetDialog = source.match(
  /<Dialog\s+open=\{!!pendingImportFile\}[\s\S]*?<DialogFooter>[\s\S]*?<\/DialogContent>\s*<\/Dialog>/
)?.[0];

test("import target dialog constrains its width to the viewport", () => {
  assert.ok(importTargetDialog, "expected import target dialog block");

  const contentClass = importTargetDialog.match(/<DialogContent className="([^"]+)"/)?.[1] ?? "";
  assert.match(contentClass, /w-\[calc\(100vw-2rem\)\]/);
  assert.match(contentClass, /max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(contentClass, /overflow-hidden/);
});

test("import target option cards cannot exceed dialog width", () => {
  assert.ok(importTargetDialog, "expected import target dialog block");

  const optionButtonClasses = Array.from(
    importTargetDialog.matchAll(/<button[\s\S]*?className="([^"]+)"[\s\S]*?>/g),
    (match) => match[1]
  ).filter((className) => className.includes("rounded-lg"));

  assert.equal(optionButtonClasses.length, 2);
  for (const className of optionButtonClasses) {
    assert.match(className, /\bw-full\b/);
    assert.match(className, /\bmin-w-0\b/);
    assert.match(className, /\bmax-w-full\b/);
  }

  const iconClasses = Array.from(
    importTargetDialog.matchAll(/<(MessageSquareText|AlignLeft)[^>]*className="([^"]+)"/g),
    (match) => match[2]
  );
  assert.deepEqual(iconClasses, ["shrink-0 text-primary", "shrink-0 text-primary"]);

  const textBodyCount = (importTargetDialog.match(/className="min-w-0 flex-1"/g) ?? []).length;
  assert.equal(textBodyCount, 2);
});
