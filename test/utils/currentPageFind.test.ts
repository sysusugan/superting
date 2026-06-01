import assert from "node:assert/strict";
import test from "node:test";

import {
  countFindMatches,
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
