import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowActionProcessingOverlay } from "../../src/components/notes/actionProcessingOverlayState.ts";

test("shows immediately when mounted with processing state", () => {
  assert.equal(shouldShowActionProcessingOverlay("processing", false), true);
});

test("shows immediately when mounted with success state", () => {
  assert.equal(shouldShowActionProcessingOverlay("success", false), true);
});

test("keeps idle overlay visible only while fading out", () => {
  assert.equal(shouldShowActionProcessingOverlay("idle", true), true);
  assert.equal(shouldShowActionProcessingOverlay("idle", false), false);
});
