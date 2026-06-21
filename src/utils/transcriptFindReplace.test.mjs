import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countMatches, replaceAllMatches } from "./transcriptFindReplace.ts";

describe("transcriptFindReplace", () => {
  it("counts case-insensitive matches by default", () => {
    assert.equal(countMatches("SuperTing superting SUPERTING", "superting"), 3);
  });

  it("can count case-sensitive matches", () => {
    assert.equal(
      countMatches("SuperTing superting SUPERTING", "superting", {
        ignoreCase: false,
      }),
      1
    );
  });

  it("replaces all matches while escaping plain-text search input", () => {
    assert.equal(
      replaceAllMatches("Use a.b and A.B carefully", "a.b", "term"),
      "Use term and term carefully"
    );
  });
});
