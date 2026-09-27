import test from "node:test";
import assert from "node:assert/strict";
import { assignReviewDraftItem } from "../../src/components/tracking/trackingReviewDraft.ts";

test("clicking new again cancels the pending creation choice", () => {
  const draft = { matchedItems: [], newItems: [{ ref: "new:1", itemId: null }], updates: [] };
  const selected = assignReviewDraftItem(draft, "new:1");
  assert.equal(selected.newItems[0].createNew, true);
  const cancelled = assignReviewDraftItem(selected, "new:1");
  assert.equal(cancelled.newItems[0].createNew, false);
  assert.equal(cancelled.newItems[0].itemId, null);
  const linked = assignReviewDraftItem(selected, "new:1", 42);
  assert.equal(linked.newItems[0].createNew, false);
  assert.equal(linked.newItems[0].itemId, 42);
  assert.deepEqual(draft, {
    matchedItems: [],
    newItems: [{ ref: "new:1", itemId: null }],
    updates: [],
  });
});
