#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

function electronBinaryPath() {
  if (process.platform === "win32") {
    return path.join(projectRoot, "node_modules", ".bin", "electron.cmd");
  }

  return path.join(projectRoot, "node_modules", ".bin", "electron");
}

function packagedAppBinaryPath() {
  let appDir;
  let binary;

  if (process.platform === "darwin") {
    appDir = path.join(projectRoot, "dist", `mac-${process.arch}`, "OpenWhispr.app");
    binary = path.join(appDir, "Contents", "MacOS", "OpenWhispr");
  } else if (process.platform === "win32") {
    appDir = path.join(projectRoot, "dist", "win-unpacked");
    binary = path.join(appDir, "OpenWhispr.exe");
  } else if (process.platform === "linux") {
    appDir = path.join(projectRoot, "dist", "linux-unpacked");
    binary = path.join(appDir, "OpenWhispr");
  } else {
    throw new Error(
      `Packaged native verification is not implemented for ${process.platform}`
    );
  }

  const resourcesDir =
    process.platform === "darwin"
      ? path.join(appDir, "Contents", "Resources")
      : path.join(appDir, "resources");

  return {
    binary,
    modulePath: path.join(
      resourcesDir,
      "app.asar.unpacked",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node"
    ),
  };
}

function verifyLoad(binary, modulePath, label) {
  if (!fs.existsSync(binary)) {
    throw new Error(`${label} Electron binary not found: ${binary}`);
  }

  if (!fs.existsSync(modulePath)) {
    throw new Error(`${label} native module not found: ${modulePath}`);
  }

  const result = spawnSync(
    binary,
    ["-e", `require(${JSON.stringify(modulePath)}); console.log("ok")`],
    {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} native module failed to load:\n${output}`);
  }

  console.log(
    `[verify-electron-native-deps] ${label} native module loads with Electron`
  );
}

const mode = process.argv.includes("--packaged") ? "packaged" : "local";

if (mode === "packaged") {
  const { binary, modulePath } = packagedAppBinaryPath();
  verifyLoad(binary, modulePath, "packaged better-sqlite3");
} else {
  verifyLoad(
    electronBinaryPath(),
    path.join(
      projectRoot,
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node"
    ),
    "local better-sqlite3"
  );
}
