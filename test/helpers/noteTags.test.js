const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function createDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-note-tags-"));
  const db = new DatabaseManager({ dbPath: path.join(root, "transcriptions.db") });
  t.after(() => {
    db.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return db;
}

test("note tag migration creates relational tables and existing notes return empty tags", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Existing", "", "personal").note;
  const tables = db.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tags', 'note_tags')")
    .all()
    .map((row) => row.name)
    .sort();

  assert.deepEqual(tables, ["note_tags", "tags"]);
  assert.deepEqual(db.getNote(note.id).tags, []);
});

test("saveNote normalizes, deduplicates, and returns multiple tags", (t) => {
  const db = createDatabase(t);
  const result = db.saveNote(
    "Tagged",
    "Roadmap",
    "personal",
    null,
    null,
    null,
    null,
    [" AI+KOC ", "产品", "ai+koc", ""]
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.note.tags, ["AI+KOC", "产品"]);
  assert.deepEqual(db.getNote(result.note.id).tags, ["AI+KOC", "产品"]);
  assert.deepEqual(db.getTags(), [
    { id: 1, name: "AI+KOC", note_count: 1 },
    { id: 2, name: "产品", note_count: 1 },
  ]);
});

test("updateNote replaces, preserves, and clears tags", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Tagged", "", "personal", null, null, null, null, ["产品"]).note;

  const replaced = db.updateNote(note.id, { tags: ["AI+KOC"] });
  assert.deepEqual(replaced.note.tags, ["AI+KOC"]);

  const preserved = db.updateNote(note.id, { title: "Renamed" });
  assert.deepEqual(preserved.note.tags, ["AI+KOC"]);

  const cleared = db.updateNote(note.id, { tags: [] });
  assert.deepEqual(cleared.note.tags, []);
  assert.deepEqual(db.getTags(), []);
});

test("note lists and search match any selected tag", (t) => {
  const db = createDatabase(t);
  db.saveNote("Roadmap one", "Alpha", "personal", null, null, null, null, ["AI", "产品"]);
  db.saveNote("Roadmap two", "Beta", "personal", null, null, null, null, ["AI"]);
  db.saveNote("Roadmap three", "Gamma", "personal", null, null, null, null, ["商机"]);

  assert.deepEqual(
    db.getNotes(null, 10, null, "createdAt", ["产品", "商机"]).map((note) => note.title),
    ["Roadmap three", "Roadmap one"]
  );
  assert.deepEqual(
    db.searchNotes("Roadmap", 10, ["产品", "商机"]).map((note) => note.title),
    ["Roadmap one", "Roadmap three"]
  );
});
