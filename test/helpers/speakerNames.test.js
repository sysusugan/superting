const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function createDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-speaker-names-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = new DatabaseManager({ dbPath: path.join(root, "transcriptions.db") });
  t.after(() => db.cleanup());
  return db;
}

test("speaker names can be created and listed without voice embeddings", (t) => {
  const db = createDatabase(t);

  const created = db.upsertSpeakerName("Vicky", null);
  const names = db.getSpeakerNames();

  assert.equal(created.display_name, "Vicky");
  assert.equal(created.email, null);
  assert.equal(names.length, 1);
  assert.equal(names[0].display_name, "Vicky");
});

test("speaker names dedupe by case-insensitive display name", (t) => {
  const db = createDatabase(t);

  const first = db.upsertSpeakerName("Vicky", null);
  const second = db.upsertSpeakerName("vicky", "vicky@example.com");
  const names = db.getSpeakerNames();

  assert.equal(second.id, first.id);
  assert.equal(names.length, 1);
  assert.equal(names[0].display_name, "vicky");
  assert.equal(names[0].email, "vicky@example.com");
});
