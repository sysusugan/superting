import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveSegmentFindMatch,
  countFindMatches,
  getFindMatchPreview,
  getNextFindIndex,
  replaceAllFindMatches,
  replaceFindMatchAt,
} from "../../src/utils/currentPageFind.ts";

test("counts literal current-page find matches case-insensitively by default", () => {
  assert.equal(countFindMatches("Alpha alpha ALPHA", "alpha"), 3);
  assert.equal(countFindMatches("a.b a?b a*b", "a.b"), 1);
});

test("counts literal current-page find matches case-sensitively when requested", () => {
  assert.equal(countFindMatches("Alpha alpha ALPHA", "alpha", { ignoreCase: false }), 1);
});

test("wraps find navigation forward and backward", () => {
  assert.equal(getNextFindIndex(-1, 3, 1), 0);
  assert.equal(getNextFindIndex(0, 3, 1), 1);
  assert.equal(getNextFindIndex(2, 3, 1), 0);
  assert.equal(getNextFindIndex(0, 3, -1), 2);
  assert.equal(getNextFindIndex(1, 0, 1), -1);
});

test("replaces a specific literal match by index", () => {
  assert.equal(replaceFindMatchAt("QC qc QC", "qc", "QA", 1), "QC QA QC");
  assert.equal(replaceFindMatchAt("QC qc QC", "qc", "QA", 0, { ignoreCase: false }), "QC QA QC");
  assert.equal(replaceFindMatchAt("QC qc QC", "missing", "QA", 0), "QC qc QC");
});

test("replaces all literal matches while escaping search input", () => {
  assert.equal(
    replaceAllFindMatches("Use a.b and A.B carefully", "a.b", "term"),
    "Use term and term carefully"
  );
  assert.equal(
    replaceAllFindMatches("Use a.b and A.B carefully", "a.b", "term", { ignoreCase: false }),
    "Use term and A.B carefully"
  );
});

test("maps a global find index to a segment-local match", () => {
  const segments = [
    { id: "a", text: "QC is here" },
    { id: "b", text: "No match" },
    { id: "c", text: "qc appears, then QC again" },
  ];

  assert.deepEqual(getActiveSegmentFindMatch(segments, "qc", 2), {
    segmentId: "c",
    segmentIndex: 2,
    localMatchIndex: 1,
    segmentMatchStartIndex: 1,
    segmentMatchCount: 2,
  });
  assert.equal(getActiveSegmentFindMatch(segments, "missing", 0), null);
});

test("builds a compact preview around a specific find match", () => {
  assert.deepEqual(getFindMatchPreview("before words around QC after words", "qc", 0, 8), {
    before: "around ",
    match: "QC",
    after: " after w",
    hasLeadingEllipsis: true,
    hasTrailingEllipsis: true,
  });
});
