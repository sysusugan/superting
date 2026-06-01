import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getNoteOrderByClause } = require("./database.js");

describe("getNoteOrderByClause", () => {
  it("defaults to updated_at ordering", () => {
    assert.equal(getNoteOrderByClause(), "updated_at DESC, id DESC");
  });

  it("supports created_at ordering", () => {
    assert.equal(getNoteOrderByClause("createdAt"), "created_at DESC, id DESC");
  });

  it("rejects unknown sort keys", () => {
    assert.throws(() => getNoteOrderByClause("title"), /Invalid note sort key/);
  });
});
