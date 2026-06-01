import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunNoteActionTool,
  writeNoteContentTool,
} from "../../src/services/tools/noteActionChatTools.ts";

const currentNote = {
  id: 42,
  title: "Customer call",
  content: "Original note",
  enhanced_content: null,
  transcript: null,
  folder_id: null,
};

test("run_note_action returns a confirmation request for the current note", async () => {
  const tool = createRunNoteActionTool({
    currentNote,
    availableActions: [
      {
        id: 7,
        name: "总结会议",
        description: "",
        prompt: "Summarize",
        icon: "sparkles",
        output_target: "enhanced_content",
        write_mode: "append",
        is_builtin: 0,
        sort_order: 1,
        translation_key: null,
        created_at: "2026-06-01",
        updated_at: "2026-06-01",
      },
    ],
  });

  const result = await tool.execute({ actionName: "总结会议" });

  assert.equal(result.success, true);
  assert.equal(result.displayText, 'Confirm action: "总结会议"');
  assert.deepEqual(result.data, {
    confirmationRequired: true,
    confirmationStatus: "pending",
    confirmationType: "run_note_action",
    payload: {
      actionId: 7,
      noteId: 42,
    },
  });
});

test("write_note_content returns a confirmation request with target and write mode", async () => {
  const result = await writeNoteContentTool.execute({
    content: "AI answer",
    target: "content",
    writeMode: "overwrite",
  });

  assert.equal(result.success, true);
  assert.equal(result.displayText, "Confirm writing AI response to notes");
  assert.deepEqual(result.data, {
    confirmationRequired: true,
    confirmationStatus: "pending",
    confirmationType: "write_note_content",
    payload: {
      content: "AI answer",
      target: "content",
      writeMode: "overwrite",
    },
  });
});
