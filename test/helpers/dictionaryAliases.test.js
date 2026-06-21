const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

test("dictionary aliases persist in SQLite", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-dictionary-aliases-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, "transcriptions.db");

  const db = new DatabaseManager({ dbPath });
  db.setDictionaryAliases([{ from: "Antibus", to: "EntVerse" }]);
  db.db.close();
  db.db = null;

  const reopened = new DatabaseManager({ dbPath });
  t.after(() => reopened.cleanup());

  assert.deepEqual(reopened.getDictionaryAliases(), [{ from: "Antibus", to: "EntVerse" }]);
});
