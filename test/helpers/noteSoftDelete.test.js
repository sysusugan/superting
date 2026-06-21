const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function createDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-soft-delete-"));
  const db = new DatabaseManager({ dbPath: path.join(root, "transcriptions.db") });
  t.after(() => {
    db.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return db;
}

test("updateNote does not update or return soft-deleted notes", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Delete me", "original", "personal").note;

  assert.equal(db.deleteNote(note.id).success, true);

  const result = db.updateNote(note.id, { content: "late autosave" });

  assert.equal(result.success, false);
  assert.equal(result.note, undefined);
  assert.deepEqual(db.getNotes(null, 10).map((item) => item.id), []);
});
