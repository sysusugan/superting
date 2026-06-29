const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const scriptPath = path.join(root, "scripts/package-mac.js");
const packageJson = require(path.join(root, "package.json"));

test("mac build scripts use the verified native packaging pipeline", () => {
  assert.equal(packageJson.scripts["build:mac"], "node scripts/package-mac.js");
  assert.equal(packageJson.scripts["build:mac:arm64"], "node scripts/package-mac.js --arch arm64");
  assert.equal(packageJson.scripts["build:mac:x64"], "node scripts/package-mac.js --arch x64");
  assert.ok(fs.existsSync(scriptPath), "scripts/package-mac.js must exist");
});

test("mac packaging rebuilds and verifies Electron native modules in order", () => {
  assert.ok(fs.existsSync(scriptPath), "scripts/package-mac.js must exist");
  const { runMacPackage } = require(scriptPath);
  const calls = [];

  runMacPackage({
    arch: "arm64",
    hostArch: "arm64",
    platform: "darwin",
    projectRoot: "/repo",
    nodeExecutable: "/node",
    packageVersion: "1.0.1",
    run: (command, args) => calls.push([command, args]),
  });

  assert.deepEqual(calls, [
    ["npm", ["run", "build:renderer"]],
    ["/node", ["scripts/sqlite-abi.js", "rebuild-electron"]],
    ["/node", ["scripts/verify-electron-native-deps.js"]],
    ["npx", ["--no-install", "electron-builder", "--mac", "--arm64", "--config.npmRebuild=false"]],
    ["/node", ["scripts/verify-electron-native-deps.js", "--packaged"]],
    ["hdiutil", ["verify", "/repo/dist/SuperTing-1.0.1-arm64.dmg"]],
    ["/node", ["scripts/sqlite-abi.js", "rebuild"]],
  ]);
});

test("mac packaging restores the Node ABI after a build failure", () => {
  assert.ok(fs.existsSync(scriptPath), "scripts/package-mac.js must exist");
  const { runMacPackage } = require(scriptPath);
  const calls = [];

  assert.throws(
    () =>
      runMacPackage({
        arch: "arm64",
        hostArch: "arm64",
        platform: "darwin",
        projectRoot: "/repo",
        nodeExecutable: "/node",
        packageVersion: "1.0.1",
        run: (command, args) => {
          calls.push([command, args]);
          if (command === "npx") throw new Error("packaging failed");
        },
      }),
    /packaging failed/
  );

  assert.deepEqual(calls.at(-1), ["/node", ["scripts/sqlite-abi.js", "rebuild"]]);
});
