const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("official hosted API defaults are not configured in the open-source build", () => {
  const constants = fs.readFileSync(
    path.resolve(__dirname, "../../src/config/constants.ts"),
    "utf8"
  );

  assert.match(constants, /export const SUPERTING_API_URL = "";/);
  assert.doesNotMatch(constants, /api\.superting\.com/i);
});
