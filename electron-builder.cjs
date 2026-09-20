const config = require("./scripts/electron-builder-base.json");
const { getReleaseVersion } = require("./scripts/release-version");

const version = getReleaseVersion();
module.exports = {
  ...config,
  extraMetadata: { ...config.extraMetadata, version },
  buildVersion: version,
};
