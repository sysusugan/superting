const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BRAND,
  getCacheRoot,
  getConfigRoot,
  migrateLegacyDirectory,
} = require("../../src/helpers/brandConfig");

test("brand config exposes SuperTing runtime identifiers", () => {
  assert.equal(BRAND.productName, "SuperTing");
  assert.equal(BRAND.chineseName, "超级听记");
  assert.equal(BRAND.slug, "superting");
  assert.equal(BRAND.appId, "com.sysusugan.superting");
  assert.equal(BRAND.protocol, "superting");
  assert.equal(BRAND.noteAssetProtocol, "superting-note-asset");
  assert.equal(BRAND.noteAudioProtocol, "superting-note-audio");
  assert.equal(BRAND.dbusService, "com.sysusugan.SuperTing");
});

test("brand config resolves new cache and config roots", () => {
  const homeDir = path.join(os.tmpdir(), "superting-home");

  assert.equal(getCacheRoot(homeDir), path.join(homeDir, ".cache", "superting"));
  assert.equal(getConfigRoot(homeDir), path.join(homeDir, ".superting"));
});

test("migrateLegacyDirectory copies OpenWhispr data once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superting-migration-"));
  const legacyDir = path.join(root, ".openwhispr");
  const targetDir = path.join(root, ".superting");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "cli-bridge.json"), '{"port":8200}');

  const result = migrateLegacyDirectory(legacyDir, targetDir, "config");

  assert.equal(result.migrated, true);
  assert.equal(fs.readFileSync(path.join(targetDir, "cli-bridge.json"), "utf8"), '{"port":8200}');
  assert.equal(fs.existsSync(path.join(targetDir, ".superting-migrated-from-openwhispr")), true);

  const second = migrateLegacyDirectory(legacyDir, targetDir, "config");
  assert.equal(second.migrated, false);
  assert.equal(second.reason, "target-exists");
});
