import { test } from "node:test";
import assert from "node:assert/strict";
import { removeDraftItem } from "../../src/components/tracking/removeDraftItem.ts";

test("removing a draft item removes incoming/outgoing relations and updates without mutating the snapshot", () => {
  const draft = {
    matchedItems: [{ ref: "a", itemId: 7, title: "Same" }],
    newItems: [{ ref: "b", title: "Same" }],
    updates: [
      { itemRef: "a" },
      { itemRef: "b", relatedItemRef: "a" },
      { itemRef: "b", content: "keep" },
    ],
    relations: [
      { sourceRef: "a", targetRef: "b" },
      { sourceRef: "b", targetRef: "a" },
    ],
    uncertainties: [{ content: "source uncertainty" }],
  };
  const original = structuredClone(draft);
  const result = removeDraftItem(draft, "a");
  assert.deepEqual(result.matchedItems, []);
  assert.deepEqual(result.newItems, draft.newItems);
  assert.deepEqual(result.updates, [{ itemRef: "b", content: "keep" }]);
  assert.deepEqual(result.relations, []);
  assert.deepEqual(result.uncertainties, draft.uncertainties);
  assert.deepEqual(draft, original);
  const empty = removeDraftItem(result, "b");
  assert.deepEqual(empty.newItems, []);
  assert.deepEqual(empty.updates, []);
  assert.deepEqual(removeDraftItem(draft, "unknown"), draft);
});
