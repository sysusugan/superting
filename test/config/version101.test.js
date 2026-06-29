const test = require("node:test");
const assert = require("node:assert/strict");

const packageJson = require("../../package.json");
const packageLock = require("../../package-lock.json");

test("application and lockfile versions are 1.0.1", () => {
  assert.equal(packageJson.version, "1.0.1");
  assert.equal(packageLock.version, "1.0.1");
  assert.equal(packageLock.packages[""].version, "1.0.1");
});
