import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMarkdownReplaceRequest,
  insertMarkdownImageReference,
} from "../../src/utils/markdownSourceEditor.ts";

test("inserts markdown image reference at the current selection", () => {
  const result = insertMarkdownImageReference({
    value: "before selected after",
    selectionStart: 7,
    selectionEnd: 15,
    src: "superting-note-asset://abc123",
    alt: "diagram] one",
  });

  assert.equal(result.value, "before ![diagram\\] one](superting-note-asset://abc123) after");
  assert.deepEqual(result.selection, {
    start: 54,
    end: 54,
  });
});

test("appends markdown image reference when there is no valid selection", () => {
  const result = insertMarkdownImageReference({
    value: "existing",
    selectionStart: -1,
    selectionEnd: -1,
    src: "superting-note-asset://abc123",
    alt: "",
  });

  assert.equal(result.value, "existing\n\n![](superting-note-asset://abc123)");
});

test("replaces a single markdown source match by active index", () => {
  assert.deepEqual(
    applyMarkdownReplaceRequest("QC qc QC", {
      mode: "current",
      query: "qc",
      replacement: "QA",
      activeIndex: 1,
      ignoreCase: true,
    }),
    {
      value: "QC QA QC",
      replaced: 1,
    }
  );
});

test("replaces all markdown source matches", () => {
  assert.deepEqual(
    applyMarkdownReplaceRequest("Use a.b and A.B", {
      mode: "all",
      query: "a.b",
      replacement: "term",
      activeIndex: -1,
      ignoreCase: true,
    }),
    {
      value: "Use term and term",
      replaced: 2,
    }
  );
});
