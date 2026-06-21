const fs = require("fs");
const path = require("path");

const BRAND = Object.freeze({
  productName: "SuperTing",
  chineseName: "超级听记",
  slug: "superting",
  legacySlug: "openwhispr",
  appId: "com.sysusugan.superting",
  protocol: "superting",
  legacyProtocol: "openwhispr",
  noteAssetProtocol: "superting-note-asset",
  legacyNoteAssetProtocol: "openwhispr-note-asset",
  noteAudioProtocol: "superting-note-audio",
  legacyNoteAudioProtocol: "openwhispr-note-audio",
  dbusService: "com.sysusugan.SuperTing",
  dbusObjectPath: "/com/sysusugan/SuperTing",
  legacyDbusService: "com.openwhispr.App",
});

const MIGRATION_SENTINEL = ".superting-migrated-from-openwhispr";

function getCacheRoot(homeDir) {
  return path.join(homeDir, ".cache", BRAND.slug);
}

function getLegacyCacheRoot(homeDir) {
  return path.join(homeDir, ".cache", BRAND.legacySlug);
}

function getConfigRoot(homeDir) {
  return path.join(homeDir, `.${BRAND.slug}`);
}

function getLegacyConfigRoot(homeDir) {
  return path.join(homeDir, `.${BRAND.legacySlug}`);
}

function migrateLegacyDirectory(legacyDir, targetDir, label = "data") {
  if (fs.existsSync(targetDir)) {
    return { migrated: false, reason: "target-exists", targetDir };
  }
  if (!fs.existsSync(legacyDir)) {
    return { migrated: false, reason: "legacy-missing", legacyDir };
  }

  fs.cpSync(legacyDir, targetDir, { recursive: true, errorOnExist: false });
  fs.writeFileSync(
    path.join(targetDir, MIGRATION_SENTINEL),
    JSON.stringify({
      label,
      legacyDir,
      migratedAt: new Date().toISOString(),
    })
  );
  return { migrated: true, legacyDir, targetDir };
}

function ensureMigratedPath(homeDir, kind) {
  if (kind === "cache") {
    const legacyDir = getLegacyCacheRoot(homeDir);
    const targetDir = getCacheRoot(homeDir);
    migrateLegacyDirectory(legacyDir, targetDir, kind);
    return targetDir;
  }
  const legacyDir = getLegacyConfigRoot(homeDir);
  const targetDir = getConfigRoot(homeDir);
  migrateLegacyDirectory(legacyDir, targetDir, kind);
  return targetDir;
}

module.exports = {
  BRAND,
  MIGRATION_SENTINEL,
  ensureMigratedPath,
  getCacheRoot,
  getConfigRoot,
  getLegacyCacheRoot,
  getLegacyConfigRoot,
  migrateLegacyDirectory,
};
