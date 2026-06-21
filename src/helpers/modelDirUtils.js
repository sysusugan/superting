const { app } = require("electron");
const os = require("os");
const path = require("path");
const { ensureMigratedPath } = require("./brandConfig");

function getCacheRoot() {
  const homeDir = app?.getPath?.("home") || os.homedir();
  return ensureMigratedPath(homeDir, "cache");
}

function getModelsDirForService(service) {
  return path.join(getCacheRoot(), `${service}-models`);
}

module.exports = { getCacheRoot, getModelsDirForService };
