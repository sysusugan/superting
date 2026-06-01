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

test("new actions default to overwriting note content", (t) => {
  const db = createDatabase(t);

  const result = db.createAction("Summarize", "", "Summarize this");

  assert.equal(result.success, true);
  assert.equal(result.action.output_target, "content");
  assert.equal(result.action.write_mode, "overwrite");
});

test("database seeds four default actions with only meeting minutes built in", (t) => {
  const db = createDatabase(t);

  const actions = db.getActions();

  assert.deepEqual(
    actions.map((action) => ({
      name: action.name,
      is_builtin: action.is_builtin,
      output_target: action.output_target,
      write_mode: action.write_mode,
      sort_order: action.sort_order,
    })),
    [
      {
        name: "生成会议纪要",
        is_builtin: 1,
        output_target: "content",
        write_mode: "overwrite",
        sort_order: 0,
      },
      {
        name: "生成面评",
        is_builtin: 0,
        output_target: "content",
        write_mode: "overwrite",
        sort_order: 1,
      },
      {
        name: "生成笔记",
        is_builtin: 0,
        output_target: "content",
        write_mode: "overwrite",
        sort_order: 2,
      },
      {
        name: "优化转录文本",
        is_builtin: 0,
        output_target: "content",
        write_mode: "overwrite",
        sort_order: 3,
      },
    ]
  );
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
