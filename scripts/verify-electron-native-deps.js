#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const asar = require("@electron/asar");

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
    appDir = path.join(projectRoot, "dist", `mac-${process.arch}`, "SuperTing.app");
    binary = path.join(appDir, "Contents", "MacOS", "SuperTing");
  } else if (process.platform === "win32") {
    appDir = path.join(projectRoot, "dist", "win-unpacked");
    binary = path.join(appDir, "SuperTing.exe");
  } else if (process.platform === "linux") {
    appDir = path.join(projectRoot, "dist", "linux-unpacked");
    binary = path.join(appDir, "SuperTing");
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
    appAsarPath: path.join(resourcesDir, "app.asar"),
    betterSqliteEntryPath: path.join(
      resourcesDir,
      "app.asar",
      "node_modules",
      "better-sqlite3"
    ),
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

function verifyPackagedAsarDependencies(appAsarPath) {
  if (!fs.existsSync(appAsarPath)) {
    throw new Error(`packaged app.asar not found: ${appAsarPath}`);
  }

  const files = asar.listPackage(appAsarPath);
  const requiredFiles = [
    "/node_modules/better-sqlite3/lib/database.js",
    "/node_modules/bindings/bindings.js",
    "/node_modules/file-uri-to-path/index.js",
  ];
  const missing = requiredFiles.filter((file) => !files.includes(file));
  if (missing.length > 0) {
    throw new Error(`packaged app.asar missing runtime dependencies:\n${missing.join("\n")}`);
  }
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

function verifyRequire(binary, modulePath, label) {
  if (!fs.existsSync(binary)) {
    throw new Error(`${label} Electron binary not found: ${binary}`);
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
    throw new Error(`${label} failed to require:\n${output}`);
  }

  console.log(`[verify-electron-native-deps] ${label} require path works with Electron`);
}

const mode = process.argv.includes("--packaged") ? "packaged" : "local";

if (mode === "packaged") {
  const { binary, appAsarPath, betterSqliteEntryPath, modulePath } = packagedAppBinaryPath();
  verifyPackagedAsarDependencies(appAsarPath);
  verifyRequire(binary, betterSqliteEntryPath, "packaged better-sqlite3 JS entry");
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
