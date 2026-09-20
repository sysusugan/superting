const test = require("node:test");
const assert = require("node:assert/strict");

const packageJson = require("../../package.json");
const packageLock = require("../../package-lock.json");

test("application and lockfile versions agree and use release timestamp format", () => {
  require("../../scripts/release-version").validateReleaseVersion(packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
});
