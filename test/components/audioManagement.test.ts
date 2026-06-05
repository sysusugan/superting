import assert from "node:assert/strict";
import test from "node:test";

import {
  getAudioBulkAction,
  getAudioBulkAvailability,
} from "../../src/components/notes/audioManagement.ts";

test("bulk audio availability detects merge and compression eligibility", () => {
  assert.deepEqual(
    getAudioBulkAvailability([
      { extension: "wav" },
      { extension: "webm" },
    ]),
    { canMerge: true, canCompress: true }
  );
  assert.deepEqual(getAudioBulkAvailability([{ extension: "webm" }]), {
    canMerge: false,
    canCompress: false,
  });
});

test("bulk audio action labels merge and compress as a single operation", () => {
  assert.deepEqual(getAudioBulkAction({ merge: false, compress: false }), {
    labelKey: "notes.editor.executeAudioAction",
    runningLabelKey: "notes.editor.executingAudioAction",
    requiresMergeConfirmation: false,
    operation: "none",
  });
  assert.deepEqual(getAudioBulkAction({ merge: false, compress: true }), {
    labelKey: "notes.editor.compressAudio",
    runningLabelKey: "notes.editor.compressingAudio",
    requiresMergeConfirmation: false,
    operation: "compress",
  });
  assert.deepEqual(getAudioBulkAction({ merge: true, compress: false }), {
    labelKey: "notes.editor.mergeAudio",
    runningLabelKey: "notes.editor.mergingAudio",
    requiresMergeConfirmation: true,
    operation: "merge",
  });
  assert.deepEqual(getAudioBulkAction({ merge: true, compress: true }), {
    labelKey: "notes.editor.mergeAndCompressAudio",
    runningLabelKey: "notes.editor.mergingAudio",
    requiresMergeConfirmation: true,
    operation: "merge",
  });
});
