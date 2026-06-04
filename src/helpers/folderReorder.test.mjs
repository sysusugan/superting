import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildFolderReorderPlan } = require("./database.js");

describe("buildFolderReorderPlan", () => {
  it("assigns zero-based sort order in the requested order", () => {
    assert.deepEqual(buildFolderReorderPlan([10, 20], [20, 10]), [
      { id: 20, sortOrder: 0 },
      { id: 10, sortOrder: 1 },
    ]);
  });

  it("rejects duplicate folder ids", () => {
    assert.throws(() => buildFolderReorderPlan([10, 20], [10, 10]), /duplicate/i);
  });

  it("rejects missing folder ids", () => {
    assert.throws(() => buildFolderReorderPlan([10, 20], [20, 999]), /existing folders/i);
  });
});
