const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function createDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-actions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = new DatabaseManager({ dbPath: path.join(root, "transcriptions.db") });
  t.after(() => db.cleanup());
  return db;
}

test("new actions default to overwriting enhanced content", (t) => {
  const db = createDatabase(t);

  const result = db.createAction("Summarize", "", "Summarize this");

  assert.equal(result.success, true);
  assert.equal(result.action.output_target, "enhanced_content");
  assert.equal(result.action.write_mode, "overwrite");
});

test("actions can persist output target and write mode", (t) => {
  const db = createDatabase(t);
  const result = db.createAction("Append to note", "", "Append this", "sparkles", {
    output_target: "content",
    write_mode: "append",
  });

  assert.equal(result.action.output_target, "content");
  assert.equal(result.action.write_mode, "append");

  const updated = db.updateAction(result.action.id, {
    output_target: "enhanced_content",
    write_mode: "overwrite",
  });

  assert.equal(updated.action.output_target, "enhanced_content");
  assert.equal(updated.action.write_mode, "overwrite");
});
