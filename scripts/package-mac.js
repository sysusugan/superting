#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SUPPORTED_ARCHS = new Set(["arm64", "x64"]);

function parseArch(args = process.argv.slice(2), fallback = process.arch) {
  const inlineArg = args.find((arg) => arg.startsWith("--arch="));
  if (inlineArg) return inlineArg.slice("--arch=".length);

  const archIndex = args.indexOf("--arch");
  if (archIndex >= 0 && args[archIndex + 1]) return args[archIndex + 1];
  return fallback;
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function runMacPackage(options = {}) {
  const arch = options.arch || process.arch;
  const hostArch = options.hostArch || process.arch;
  const platform = options.platform || process.platform;
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const packageVersion =
    options.packageVersion || require(path.join(projectRoot, "package.json")).version;
  const run = options.run || ((command, args) => runCommand(command, args, projectRoot));

  if (platform !== "darwin") {
    throw new Error(`Mac packaging requires darwin, received ${platform}`);
  }
  if (!SUPPORTED_ARCHS.has(arch)) {
    throw new Error(`Unsupported Mac architecture: ${arch}`);
  }
  if (arch !== hostArch) {
    throw new Error(
      `Native packaging must run on the target architecture (host ${hostArch}, target ${arch})`
    );
  }

  let failure;
  try {
    run("npm", ["run", "build:renderer"]);
    run(nodeExecutable, ["scripts/sqlite-abi.js", "rebuild-electron"]);
    run(nodeExecutable, ["scripts/verify-electron-native-deps.js"]);
    run("npx", [
      "--no-install",
      "electron-builder",
      "--mac",
      `--${arch}`,
      "--config.npmRebuild=false",
    ]);
    run(nodeExecutable, ["scripts/verify-electron-native-deps.js", "--packaged"]);
    run("hdiutil", [
      "verify",
      path.join(projectRoot, "dist", `SuperTing-${packageVersion}-${arch}.dmg`),
    ]);
  } catch (error) {
    failure = error;
  }

  try {
    run(nodeExecutable, ["scripts/sqlite-abi.js", "rebuild"]);
  } catch (restoreError) {
    if (!failure) {
      failure = restoreError;
    } else {
      console.error("Failed to restore the local Node ABI:", restoreError);
    }
  }

  if (failure) throw failure;
}

if (require.main === module) {
  try {
    runMacPackage({ arch: parseArch() });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = { parseArch, runMacPackage };
