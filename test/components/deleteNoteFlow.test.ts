import assert from "node:assert/strict";
import test from "node:test";

import { deleteNoteAndRefresh } from "../../src/components/notes/deleteNoteFlow.ts";

test("removes the deleted note from local state before refreshing folders", async () => {
  const calls: string[] = [];

  await deleteNoteAndRefresh({
    noteId: 42,
    deleteNote: async () => {
      calls.push("delete");
      return { success: true };
    },
    removeNote: () => calls.push("remove"),
    loadFolders: async () => calls.push("folders"),
  });

  assert.deepEqual(calls, ["delete", "remove", "folders"]);
});

test("does not remove the note locally when delete fails", async () => {
  const calls: string[] = [];

  const result = await deleteNoteAndRefresh({
    noteId: 42,
    deleteNote: async () => {
      calls.push("delete");
      return { success: false };
    },
    removeNote: () => calls.push("remove"),
    loadFolders: async () => calls.push("folders"),
  });

  assert.deepEqual(result, { success: false });
  assert.deepEqual(calls, ["delete", "folders"]);
});
