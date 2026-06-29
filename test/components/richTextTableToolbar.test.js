const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/components/ui/RichTextEditor.tsx"), "utf8");

test("rich text editor exposes table insertion and row/column commands", () => {
  for (const command of [
    "insertTable",
    "addRowBefore",
    "addRowAfter",
    "deleteRow",
    "addColumnBefore",
    "addColumnAfter",
    "deleteColumn",
    "deleteTable",
    "toggleHeaderRow",
    "toggleHeaderColumn",
    "mergeOrSplit",
  ]) {
    assert.match(
      source,
      new RegExp(`runTableCommand\\("${command}"`),
      `missing ${command} command`
    );
  }
});

test("table commands only focus the editor when an action runs", () => {
  assert.doesNotMatch(source, /const\s+tableCommands\s*=\s*editor\?\.chain\(\)\.focus\(\)/);
  assert.match(
    source,
    /const\s+runTableCommand[\s\S]*const\s+chain\s*=\s*editor\?\.chain\(\)\.focus\(\)[\s\S]*markUserEditPending\(\);\s*\n\s*chain\?\.\[command\]\?/
  );
});
