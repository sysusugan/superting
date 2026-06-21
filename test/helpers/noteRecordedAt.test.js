const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const DatabaseManager = require("../../src/helpers/database");

function createRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-recorded-at-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createDatabase(t) {
  const root = createRoot(t);
  const db = new DatabaseManager({ dbPath: path.join(root, "transcriptions.db") });
  t.after(() => db.cleanup());
  return db;
}

test("new notes include recorded_at", (t) => {
  const db = createDatabase(t);
  const columns = db.db.prepare("PRAGMA table_info(notes)").all();

  assert.ok(columns.some((column) => column.name === "recorded_at"));

  const note = db.saveNote("Recorded", "", "meeting").note;
  assert.equal(typeof note.recorded_at, "string");
  assert.ok(note.recorded_at.length > 0);
});

test("migration backfills recorded_at from created_at for existing notes", (t) => {
  const root = createRoot(t);
  const dbPath = path.join(root, "transcriptions.db");
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'Untitled Note',
      content TEXT NOT NULL DEFAULT '',
      note_type TEXT NOT NULL DEFAULT 'personal',
      source_file TEXT,
      audio_duration_seconds REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO notes (title, content, created_at, updated_at)
    VALUES ('Legacy', '', '2026-06-01 09:30:00', '2026-06-02 10:45:00');
  `);
  legacy.close();

  const db = new DatabaseManager({ dbPath });
  t.after(() => db.cleanup());

  const note = db.getNotes(null, 10)[0];
  assert.equal(note.recorded_at, "2026-06-01 09:30:00");
});

test("updateNote updates recorded_at and refreshes updated_at", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Editable date", "", "meeting").note;

  const result = db.updateNote(note.id, { recorded_at: "2026-06-03 14:15:00" });

  assert.equal(result.success, true);
  assert.equal(result.note.recorded_at, "2026-06-03 14:15:00");
  assert.ok(result.note.updated_at);
});

test("getNotes supports updated, created, and recorded date sorting", (t) => {
  const db = createDatabase(t);
  const olderCreated = db.saveNote("older created", "", "meeting").note;
  const newerCreated = db.saveNote("newer created", "", "meeting").note;

  db.updateNote(olderCreated.id, {
    recorded_at: "2026-06-05 12:00:00",
    sync_status: "pending",
  });
  db.updateNote(newerCreated.id, {
    recorded_at: "2026-06-01 12:00:00",
    sync_status: "pending",
  });
  db.db
    .prepare("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?")
    .run("2026-06-01 09:00:00", "2026-06-02 09:00:00", olderCreated.id);
  db.db
    .prepare("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?")
    .run("2026-06-03 09:00:00", "2026-06-01 09:00:00", newerCreated.id);

  assert.deepEqual(
    db.getNotes(null, 10, null, "createdAt").map((note) => note.title),
    ["newer created", "older created"]
  );
  assert.deepEqual(
    db.getNotes(null, 10, null, "updatedAt").map((note) => note.title),
    ["older created", "newer created"]
  );
  assert.deepEqual(
    db.getNotes(null, 10, null, "recordedAt").map((note) => note.title),
    ["older created", "newer created"]
  );
});
