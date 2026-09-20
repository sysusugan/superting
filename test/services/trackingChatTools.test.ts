import assert from "node:assert/strict";
import test from "node:test";
import { createTrackingChatTools } from "../../src/services/tools/trackingChatTools.ts";

test("tracking tools read persisted data and propose edits without writing", async () => {
  const item = { id: 7, title: "Saved", properties: { owner: "A", customer: "B" } };
  const templates = [{ id: 1, name: "Custom", version: 3, definition: { fields: ["owner"] } }];
  let tracking = {
    items: [item],
    updates: [],
    candidates: [{ id: 999 }],
    extractions: [{ id: 2, status: "pending", result: { updates: [] } }],
  };
  Object.assign(globalThis, {
    window: {
      electronAPI: {
        getNoteTracking: async (id: number) => {
          assert.equal(id, 42);
          return tracking;
        },
        getTrackingTemplates: async () => templates,
      },
    },
  });
  const [read, templateTool, edit] = createTrackingChatTools(42);
  await assert.rejects(edit.execute({ itemId: 7, itemPatch: { title: "New" } }));
  const result = await read.execute({});
  assert.equal((result.data as any).pending.id, 2);
  assert.equal((result.data as any).candidates, undefined);
  assert.deepEqual((await templateTool.execute({})).data, templates);
  const proposal = (await edit.execute({ itemId: 7, itemPatch: { properties: { owner: "C" } } }))
    .data as any;
  assert.equal(proposal.confirmationStatus, "pending");
  assert.equal(proposal.payload.noteId, 42);
  assert.deepEqual(proposal.payload.expected.item, item);
  assert.deepEqual(proposal.changes[0].after, { owner: "C", customer: "B" });
  await assert.rejects(edit.execute({ itemId: 999, itemPatch: { title: "Wrong" } }));
  tracking = { ...tracking, extractions: [] };
  assert.equal(((await read.execute({})).data as any).status, "notExtracted");
});
