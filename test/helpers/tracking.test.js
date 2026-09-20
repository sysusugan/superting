const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function confirmReviewed(db, id, override) {
  if (override) return db.confirmTrackingExtraction(id, override);
  const row = db.db.prepare('SELECT result_json FROM tracking_extractions WHERE id = ?').get(id);
  const draft = db.normalizeTrackingResult(JSON.parse(row.result_json));
  for (const entry of [...draft.matchedItems, ...draft.newItems]) {
    if (entry.itemId == null) entry.createNew = true;
  }
  return db.confirmTrackingExtraction(id, draft);
}

function createDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-tracking-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = new DatabaseManager({ dbPath: path.join(root, "tracking.db") });
  t.after(() => db.cleanup());
  return db;
}

test("tracking extraction is reused for unchanged note input", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("客户进展", "方案已提交", "personal", null, null, null, null, []).note;
  const action = db.getActions().find((item) => item.output_target === "tracking");
  const result = JSON.stringify({
    matchedItems: [{ title: "客户商机", itemType: "商机" }],
    updates: [
      {
        itemTitle: "客户商机",
        itemType: "商机",
        updateType: "进展",
        content: "方案已提交",
        stateAfter: "赢单",
        evidence: "方案已提交",
      },
    ],
  });

  const first = db.saveTrackingExtraction(note.id, action.id, result);
  const second = db.saveTrackingExtraction(note.id, action.id, result);

  assert.equal(first.extraction.id, second.extraction.id);
  assert.equal(second.cached, true);
});

test("confirmed extraction writes item update and evidence once", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote(
    "项目进展",
    "执行延期到九月",
    "personal",
    null,
    null,
    null,
    null,
    []
  ).note;
  const action = db.getActions().find((item) => item.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      matchedItems: [{ title: "口碑项目", itemType: "项目" }],
      updates: [
        {
          itemTitle: "口碑项目",
          itemType: "项目",
          updateType: "风险",
          content: "执行延期到九月",
          stateAfter: "暂停",
          evidence: "执行延期到九月",
        },
      ],
    })
  );

  assert.equal(confirmReviewed(db, extraction.extraction.id).success, true);
  assert.equal(confirmReviewed(db, extraction.extraction.id).alreadyConfirmed, true);
  const noteTracking = db.getNoteTracking(note.id);
  assert.equal(noteTracking.extractions[0].result.matchedItems[0].title, "口碑项目");
  const context = db.getTrackingContext({ from: "2026-01-01", to: "2027-01-01" });
  assert.equal(context.items.length, 1);
  assert.equal(context.items[0].state, "暂停");
  assert.equal(context.items[0].updates.length, 1);
  assert.equal(context.items[0].updates[0].evidence, "执行延期到九月");
});

test("confirmed extraction keeps new items visible when it has no updates", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("客户交流", "客户正在评估", "personal", null, null, null, null, []).note;
  const action = db.getActions().find((item) => item.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      matchedItems: [],
      newItems: [{ title: "客户评估商机", itemType: "商机", state: "需求评估" }],
      updates: [],
    })
  );
  assert.equal(confirmReviewed(db, extraction.extraction.id).success, true);
  const tracking = db.getNoteTracking(note.id);
  assert.equal(tracking.extractions[0].result.newItems[0].title, "客户评估商机");
});

test("changed note content creates a new extraction", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("商机", "客户正在评估", "personal", null, null, null, null, []).note;
  const action = db.getActions().find((item) => item.output_target === "tracking");
  const result = JSON.stringify({ matchedItems: [], updates: [] });
  const first = db.saveTrackingExtraction(note.id, action.id, result);
  db.updateNote(note.id, { content: "客户确认合作" });
  const second = db.saveTrackingExtraction(note.id, action.id, result);

  assert.notEqual(first.extraction.id, second.extraction.id);
  assert.equal(second.extraction.supersedes_id, first.extraction.id);
});

test("re-extraction preserves confirmed updates until confirmation, then replaces only its note", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const a = db.saveNote("A", "A text").note;
  const b = db.saveNote("B", "B text").note;
  const payload = (content) =>
    JSON.stringify({
      newItems: [{ title: "Shared item", itemType: "项目" }],
      updates: [{ itemTitle: "Shared item", content, updateType: "进展", evidence: content }],
    });
  const first = db.saveTrackingExtraction(a.id, action.id, payload("A text")).extraction;
  confirmReviewed(db, first.id);
  const other = db.saveTrackingExtraction(b.id, action.id, payload("B text")).extraction;
  confirmReviewed(db, other.id);
  const ignored = db.saveTrackingExtraction(a.id, action.id, payload("A revised"), true).extraction;
  assert.equal(db.getNoteTracking(a.id).updates[0].content, "A text");
  db.rejectTrackingExtraction(ignored.id);
  assert.equal(db.getNoteTracking(a.id).updates[0].content, "A text");
  const replacement = db.saveTrackingExtraction(
    a.id,
    action.id,
    payload("A text revised"),
    true
  ).extraction;
  assert.equal(confirmReviewed(db, replacement.id).success, true);
  assert.deepEqual(
    db.getNoteTracking(a.id).updates.map((u) => u.content),
    ["A text revised"]
  );
  assert.deepEqual(
    db.getNoteTracking(b.id).updates.map((u) => u.content),
    ["B text"]
  );
  assert.equal(
    db.getNoteTracking(a.id).extractions.find((e) => e.id === first.id).status,
    "superseded"
  );
  confirmReviewed(db, replacement.id);
  assert.equal(db.getNoteTracking(a.id).updates.length, 1);
  const invalid = db.saveTrackingExtraction(a.id, action.id, payload("invalid"), true).extraction;
  assert.equal(
    confirmReviewed(db, invalid.id, {
      updates: [{ itemTitle: "missing", content: "invalid" }],
    }).success,
    false
  );
  assert.equal(db.getNoteTracking(a.id).updates[0].content, "A text revised");
});

test("rejected and stale extractions cannot be confirmed", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const note = db.saveNote("A", "text").note;
  const first = db.saveTrackingExtraction(note.id, action.id, '{"updates":[]}').extraction;
  db.rejectTrackingExtraction(first.id);
  assert.equal(confirmReviewed(db, first.id).success, false);
  const second = db.saveTrackingExtraction(note.id, action.id, '{"updates":[]}').extraction;
  db.updateNote(note.id, { content: "changed" });
  assert.equal(confirmReviewed(db, second.id).success, false);
});

test("re-extraction with a renamed proposal reuses the existing item ID", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const note = db.saveNote("宝洁交流", "继续评估平台", "personal", null, null, null, null, []).note;
  const first = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: [{ title: "EnlightAI 企业级 Agent 平台", itemType: "商机", state: "评估中" }],
      updates: [],
    })
  ).extraction;
  assert.equal(confirmReviewed(db, first.id).success, true);
  const item = db.db.prepare("SELECT id FROM tracking_items").get();

  const second = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: [{ title: "宝洁团队评估 EnlightAI 技术架构", itemType: "商机" }],
      updates: [{ itemRef: "new:1", updateType: "进展", content: "继续评估", evidence: "继续评估" }],
    }),
    true
  ).extraction;
  const candidates = db.getTrackingCandidates(note.id);
  assert.equal(candidates.find((candidate) => candidate.id === item.id)?.linked, true);

  const draft = db.normalizeTrackingResult(second.result);
  draft.newItems[0].itemId = item.id;
  draft.newItems[0].createNew = false;
  assert.equal(db.confirmTrackingExtraction(second.id, draft).success, true);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM tracking_items").get().count, 1);
  assert.equal(db.getNoteTracking(note.id).updates[0].item_id, item.id);
});

test("explicit new assignment creates one item", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const note = db.saveNote("新商机", "首次接触", "personal", null, null, null, null, []).note;
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({ newItems: [{ title: "明确的新商机", itemType: "商机" }], updates: [] })
  ).extraction;
  const draft = db.normalizeTrackingResult(extraction.result);
  draft.newItems[0].createNew = true;
  assert.equal(db.confirmTrackingExtraction(extraction.id, draft).success, true);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM tracking_items").get().count, 1);
});
