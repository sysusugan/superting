const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function confirmReviewed(db, id, override) {
  if (override) return db.confirmTrackingExtraction(id, override);
  const row = db.db.prepare("SELECT result_json FROM tracking_extractions WHERE id = ?").get(id);
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

test("global tracking lists items without updates and resolves their source notes", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Source", "text").note;
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: [{ title: "No progress", itemType: "项目" }],
      updates: [],
    })
  ).extraction;
  assert.equal(confirmReviewed(db, extraction.id).success, true);
  const list = db.listTrackingItems({ search: "progress" });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].title, "No progress");
  const detail = db.getTrackingItemDetail(list.items[0].id);
  assert.equal(detail.updates.total, 0);
  assert.deepEqual(
    detail.notes.map((n) => n.id),
    [note.id]
  );
});

test("global edits preserve identity and properties, reject conflicts and keep stopped items in notes", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Source", "text").note;
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: [
        {
          title: "Original",
          itemType: "项目",
          properties: { customer: "A", owner: "B", obsolete: "old" },
        },
      ],
      updates: [],
    })
  ).extraction;
  confirmReviewed(db, extraction.id);
  const item = db.getTrackingItemDetail(db.listTrackingItems().items[0].id).item;
  const request = {
    expected: item,
    patch: {
      title: "Renamed",
      state: "暂停",
      isActive: false,
      properties: { owner: "C" },
      removePropertyKeys: ["obsolete"],
    },
  };
  const result = db.updateTrackingItem(item.id, request);
  assert.equal(result.success, true, result.error);
  assert.equal(result.data.item.id, item.id);
  assert.deepEqual(result.data.item.properties, { customer: "A", owner: "C" });
  assert.equal(db.getNoteTracking(note.id).items[0].title, "Renamed");
  assert.equal(db.listTrackingItems({ active: "active" }).total, 0);
  assert.equal(db.listTrackingItems({ active: "inactive" }).total, 1);
  assert.equal(db.updateTrackingItem(item.id, request).success, false);
  assert.equal(
    db.updateTrackingItem(item.id, { expected: result.data.item, patch: { template_id: 9 } })
      .success,
    false
  );
  assert.equal(db.getTrackingItemDetail(item.id).operations[0].operation, "edit-item");
});

test("manual item state survives subsequent extraction from another note", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const first = db.saveNote("First", "text").note;
  const second = db.saveNote("Second", "text").note;
  const extraction = db.saveTrackingExtraction(
    first.id,
    action.id,
    JSON.stringify({
      newItems: [{ title: "Delivery", itemType: "项目" }],
      updates: [],
    })
  ).extraction;
  confirmReviewed(db, extraction.id);
  const item = db.getTrackingItemDetail(db.listTrackingItems().items[0].id).item;
  assert.equal(
    db.updateTrackingItem(item.id, { expected: item, patch: { state: "暂停" } }).success,
    true
  );
  const next = db.saveTrackingExtraction(
    second.id,
    action.id,
    JSON.stringify({
      matchedItems: [{ ref: "existing", itemId: item.id, title: "Delivery", itemType: "项目" }],
      updates: [{ itemRef: "existing", content: "New progress", stateAfter: "已完成" }],
    })
  ).extraction;
  assert.equal(confirmReviewed(db, next.id).success, true);
  assert.equal(db.getTrackingItemDetail(item.id).item.state, "暂停");
  assert.equal(db.getTrackingItemDetail(item.id).updates.items[0].state_after, "已完成");
});

test("global pagination, literal search and invalid query boundaries", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const note = db.saveNote("Many", "text").note;
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: Array.from({ length: 31 }, (_, i) => ({ title: `Item ${i}%`, itemType: "项目" })),
      updates: [],
    })
  ).extraction;
  confirmReviewed(db, extraction.id);
  assert.equal(db.listTrackingItems({ search: "%" }).total, 31);
  assert.equal(db.listTrackingItems().items.length, 30);
  assert.equal(db.listTrackingItems({ page: 2 }).items.length, 1);
  assert.equal(db.listTrackingItems({ search: "absent" }).total, 0);
  assert.throws(() => db.listTrackingItems({ page: -1 }), /Invalid/);
  assert.throws(() => db.getTrackingItemDetail("1"), /Invalid/);
});

test("progress date filtering preserves unknown dates without treating them as in-range facts", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Dates", "text").note;
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: [{ title: "Dates", itemType: "项目" }],
      updates: ["2026-09-21", "2026-09-01", "会议结束"].map((occurredAt) => ({
        itemTitle: "Dates",
        content: occurredAt,
        occurredAt,
      })),
    })
  ).extraction;
  confirmReviewed(db, extraction.id);
  const item = db.listTrackingItems().items[0];
  const detail = db.getTrackingItemDetail(item.id, { from: "2026-09-21", to: "2026-09-21" });
  assert.equal(detail.updates.total, 2);
  assert.equal(detail.updates.items.filter((update) => update.unknown_date).length, 1);
  assert.throws(() => db.getTrackingItemDetail(item.id, { from: "2026-02-30" }), /Invalid/);
});

test("tracking migration creates a readable consistent backup before adding the new schema", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Keep this note", "Original fact").note;
  db.db.exec("ALTER TABLE tracking_items DROP COLUMN manual_state; DROP TABLE tracking_operations");
  const migrated = new DatabaseManager({ dbPath: db.dbPath });
  t.after(() => migrated.cleanup());
  assert.equal(migrated.getNote(note.id).content, "Original fact");
  const backup = fs.readdirSync(path.dirname(db.dbPath)).find((file) => file.endsWith(".bak"));
  assert.ok(backup);
  const snapshot = new (require("better-sqlite3"))(path.join(path.dirname(db.dbPath), backup), {
    readonly: true,
  });
  try {
    assert.equal(
      snapshot.prepare("SELECT content FROM notes WHERE id = ?").get(note.id).content,
      "Original fact"
    );
    assert.equal(
      snapshot
        .pragma("table_info(tracking_items)")
        .some((column) => column.name === "manual_state"),
      false
    );
  } finally {
    snapshot.close();
  }
});

test("audit write failure rolls back a global edit", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Atomic", "text").note;
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({ newItems: [{ title: "Before", itemType: "项目" }], updates: [] })
  ).extraction;
  confirmReviewed(db, extraction.id);
  const before = db.getTrackingItemDetail(db.listTrackingItems().items[0].id).item;
  db.db.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON tracking_operations BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
  );
  assert.equal(
    db.updateTrackingItem(before.id, { expected: before, patch: { title: "After" } }).success,
    false
  );
  assert.equal(db.getTrackingItemDetail(before.id).item.title, "Before");
});

test("failed tracking migration rolls back its schema change and preserves the source database", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Migration failure", "Keep original").note;
  db.db.exec("ALTER TABLE tracking_items DROP COLUMN manual_state; DROP TABLE tracking_operations; CREATE TABLE tracking_operations (unexpected TEXT)");
  assert.throws(() => new DatabaseManager({ dbPath: db.dbPath }), /item_id/);
  assert.equal(db.getNote(note.id).content, "Keep original");
  assert.equal(db.db.pragma("table_info(tracking_items)").some((column) => column.name === "manual_state"), false);
  assert.ok(fs.readdirSync(path.dirname(db.dbPath)).some((file) => file.endsWith(".bak")));
});

test("chat edits use live items, preserve properties, reject stale and foreign records", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const note = db.saveNote("A", "text").note;
  const other = db.saveNote("B", "text").note;
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({
      newItems: [
        { title: "Original", itemType: "项目", properties: { customer: "A", owner: "B" } },
      ],
      updates: [
        { itemTitle: "Original", content: "progress", stateAfter: "暂停", evidence: "source" },
      ],
    })
  ).extraction;
  confirmReviewed(db, extraction.id);
  const before = db.getNoteTracking(note.id);
  const request = {
    itemId: before.items[0].id,
    updateId: before.updates[0].id,
    itemPatch: { title: "Renamed", properties: { owner: "C" } },
    updatePatch: { content: "Corrected", state_after: "已完成" },
    expected: { item: before.items[0], update: before.updates[0] },
  };
  assert.equal(db.updateNoteTracking(other.id, request).success, false);
  const result = db.updateNoteTracking(note.id, request);
  assert.equal(result.success, true);
  assert.equal(result.data.items[0].title, "Renamed");
  assert.equal(result.data.items[0].state, "已完成");
  assert.deepEqual(result.data.items[0].properties, { customer: "A", owner: "C" });
  assert.equal(result.data.updates[0].evidence_text, "source");
  assert.equal(result.data.extractions[0].result.newItems[0].title, "Original");
  assert.equal(db.updateNoteTracking(note.id, request).success, false);
  const fresh = result.data;
  const explicit = db.updateNoteTracking(note.id, {
    itemId: fresh.items[0].id,
    itemPatch: { state: "已完成" },
    expected: { item: fresh.items[0], update: null },
  });
  assert.equal(explicit.success, true);
  const edited = db.updateNoteTracking(note.id, {
    itemId: fresh.items[0].id,
    updateId: fresh.updates[0].id,
    updatePatch: { state_after: "暂停" },
    expected: { item: explicit.data.items[0], update: explicit.data.updates[0] },
  });
  assert.equal(edited.success, true);
  assert.equal(edited.data.items[0].state, "已完成");
  assert.equal(
    db.updateNoteTracking(note.id, {
      itemId: fresh.items[0].id,
      itemPatch: { template_id: 99 },
      expected: { item: fresh.items[0], update: null },
    }).success,
    false
  );
});

test("live item without updates survives rename and legacy lookup", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("A", "text").note;
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const extraction = db.saveTrackingExtraction(
    note.id,
    action.id,
    JSON.stringify({ newItems: [{ title: "No progress", itemType: "商机" }], updates: [] })
  ).extraction;
  confirmReviewed(db, extraction.id);
  const legacy = JSON.parse(
    db.db.prepare("SELECT result_json FROM tracking_extractions WHERE id = ?").get(extraction.id)
      .result_json
  );
  delete legacy.newItems[0].itemId;
  db.db
    .prepare("UPDATE tracking_extractions SET result_json = ? WHERE id = ?")
    .run(JSON.stringify(legacy), extraction.id);
  const item = db.getNoteTracking(note.id).items[0];
  assert.equal(
    db.updateNoteTracking(note.id, {
      itemId: item.id,
      itemPatch: { title: "New name" },
      expected: { item, update: null },
    }).success,
    true
  );
  assert.equal(db.getNoteTracking(note.id).items[0].title, "New name");
});

test("candidate picker includes active same-type items even without text matches", (t) => {
  const db = createDatabase(t);
  const action = db.getActions().find((a) => a.output_target === "tracking");
  const source = db.saveNote("客户甲", "已确认", "personal", null, null, null, null, []).note;
  const unrelated = db.saveNote(
    "完全不同的笔记",
    "没有项目名称",
    "personal",
    null,
    null,
    null,
    null,
    []
  ).note;
  const extraction = db.saveTrackingExtraction(
    source.id,
    action.id,
    JSON.stringify({ newItems: [{ title: "隐身项目", itemType: "项目" }], updates: [] })
  ).extraction;
  assert.equal(confirmReviewed(db, extraction.id).success, true);
  const candidates = db.getTrackingCandidates(unrelated.id);
  assert.equal(candidates.find((candidate) => candidate.title === "隐身项目")?.linked, false);
});

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
      updates: [
        { itemRef: "new:1", updateType: "进展", content: "继续评估", evidence: "继续评估" },
      ],
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
