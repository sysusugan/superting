#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

const outputNamesByPlatform = {
  darwin: ["mac", "mac-arm64", "mac-x64", "mac-universal"],
  win32: ["win-unpacked"],
  linux: ["linux-unpacked"],
};

const outputNames = outputNamesByPlatform[process.platform] || [];

for (const outputName of outputNames) {
  const outputPath = path.join(distDir, outputName);
  if (!fs.existsSync(outputPath)) {
    continue;
  }

  fs.rmSync(outputPath, { recursive: true, force: true });
  console.log(
    `[clean-pack-output] Removed ${path.relative(projectRoot, outputPath)}`
  );
}
