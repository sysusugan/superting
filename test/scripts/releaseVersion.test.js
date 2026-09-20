const test = require("node:test");
const assert = require("node:assert/strict");
const {
  timestampVersion,
  validateReleaseVersion,
  getReleaseVersion,
} = require("../../scripts/release-version");

test("release timestamp uses Shanghai time and numeric SemVer segments", () => {
  assert.equal(timestampVersion(new Date("2026-09-15T05:47:00Z")), "26.915.1347");
  assert.equal(timestampVersion(new Date("2026-01-05T01:07:00Z")), "26.105.907");
  assert.equal(timestampVersion(new Date("2026-09-14T16:00:00Z")), "26.915.0");
  assert.equal(timestampVersion(new Date("2026-12-31T16:00:00Z")), "27.101.0");
});

test("reject invalid dates, clock times and legacy versions", () => {
  for (const invalid of [
    "1.0.1",
    "26.915.0907",
    "26.230.1200",
    "26.1301.1200",
    "26.915.2400",
    "26.915.1360",
  ]) {
    assert.throws(() => validateReleaseVersion(invalid));
  }
  assert.equal(validateReleaseVersion("28.229.2359"), "28.229.2359");
});

test("release matrix shares explicit version or tag; local packaging uses current time", () => {
  const now = new Date("2026-09-15T05:47:00Z");
  assert.equal(getReleaseVersion({}, now), "26.915.1347");
  assert.equal(getReleaseVersion({ SUPERTING_RELEASE_VERSION: "26.915.1400" }, now), "26.915.1400");
  assert.equal(
    getReleaseVersion({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v26.915.1401" }, now),
    "26.915.1401"
  );
});

test("builder uses one version for application metadata and native bundle", () => {
  const config = require("../../electron-builder.cjs");
  assert.equal(config.extraMetadata.version, config.buildVersion);
  validateReleaseVersion(config.extraMetadata.version);
});
