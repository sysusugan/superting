#!/usr/bin/env node
/**
 * SQLite ABI helper — rebuilds better-sqlite3 against the Node ABI currently
 * running this script and verifies the native module loads cleanly.
 *
 * Why this exists:
 *   `npm run pack` runs `electron-builder install-app-deps`, which recompiles
 *   better-sqlite3 against the Electron ABI (e.g. NODE_MODULE_VERSION 145 for
 *   Electron 41). After that, plain `node --test` (NODE_MODULE_VERSION 137 on
 *   Node 24) fails with ERR_DLOPEN_FAILED. Running this script before
 *   `node --test` rebuilds the binding for the local Node ABI.
 *
 * Usage:
 *   node scripts/sqlite-abi.js status   # print current ABI + binding ABI
 *   node scripts/sqlite-abi.js rebuild  # rebuild for current Node ABI
 *   node scripts/sqlite-abi.js check    # exit 0 if binding matches, 1 otherwise
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BINDING_PATH = path.join(
  PROJECT_ROOT,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);

function readBindingAbi() {
  if (!fs.existsSync(BINDING_PATH)) return null;
  // Mach-O LC_BUILD_VERSION → minos + platform; ELF → e_ident[EI_OSABI].
  // The binding embeds the Node module ABI in a custom section; the simplest
  // reliable check is "does the binding load under this Node?", which we do
  // by attempting require().
  try {
    process.dlopen({ exports: {} }, BINDING_PATH, 1 /* RTLD_LAZY */);
    return process.versions.modules;
  } catch (err) {
    if (err && err.code === "ERR_DLOPEN_FAILED") {
      const m = /NODE_MODULE_VERSION (\d+)/.exec(err.message);
      return m ? `mismatch (binding ABI ${m[1]})` : "mismatch";
    }
    throw err;
  }
}

function status() {
  const nodeAbi = process.versions.modules;
  let bindingAbi = "not built";
  if (fs.existsSync(BINDING_PATH)) {
    try {
      const binding = require("better-sqlite3/package.json");
      bindingAbi = readBindingAbi() ?? "unknown";
    } catch (err) {
      bindingAbi = "missing or unloadable";
    }
  }
  console.log(`node ABI:         ${nodeAbi}`);
  console.log(`better-sqlite3:   ${bindingAbi}`);
  console.log(
    fs.existsSync(BINDING_PATH) && bindingAbi === String(nodeAbi)
      ? "✓ binding matches node"
      : "✗ binding does NOT match node — run `node scripts/sqlite-abi.js rebuild`"
  );
}

function rebuild() {
  console.log("Rebuilding better-sqlite3 for current Node ABI...");
  // better-sqlite3's `prebuild-install || node-gyp rebuild` install script
  // picks up a prebuild for our Node ABI when one is published; otherwise it
  // falls back to a source build.
  execFileSync("npm", ["rebuild", "better-sqlite3"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  console.log("✓ rebuild complete");
}

function rebuildForElectron() {
  console.log("Rebuilding better-sqlite3 for Electron ABI...");
  // electron-builder install-app-depos is a no-op when it detects an existing
  // binding that already matches Node ABI. Force a rebuild against the
  // project's Electron target using @electron/rebuild directly.
  const electronVersion = readElectronVersion();
  if (!electronVersion) {
    console.error("✗ Cannot determine Electron version from package.json");
    process.exit(1);
  }
  console.log("  electron version:", electronVersion);
  // Run @electron/rebuild's CLI directly through node. Going via `npx` fails on
  // GitHub-hosted Windows runners where npx isn't on PATH. @electron/rebuild
  // uses `exports` in its package.json, so we can't `require.resolve` into
  // lib/cli.js — instead, resolve the package root and append lib/cli.js.
  const rebuildCli = path.join(
    PROJECT_ROOT,
    "node_modules",
    "@electron",
    "rebuild",
    "lib",
    "cli.js"
  );
  execFileSync(
    process.execPath,
    [rebuildCli, "-f", "-w", "better-sqlite3", "-v", electronVersion],
    { cwd: PROJECT_ROOT, stdio: "inherit" }
  );
  console.log("✓ rebuild complete (electron ABI)");
}

function readElectronVersion() {
  const pkg = JSON.parse(
    require("node:fs").readFileSync(
      path.join(PROJECT_ROOT, "package.json"),
      "utf8"
    )
  );
  // package.json may pin Electron via devDependencies.electron, or use a
  // range like "^41.2.0". We normalize to the major-minor form @electron/rebuild
  // wants (e.g. "41.2.0").
  const v = pkg.devDependencies?.electron || pkg.dependencies?.electron;
  if (!v) return null;
  return v.replace(/^\^|^~/, "");
}

function check() {
  if (!fs.existsSync(BINDING_PATH)) {
    console.error("✗ better-sqlite3 binding not found at", BINDING_PATH);
    console.error("  Run: npm install");
    process.exit(1);
  }

  // First, try loading against the current Node ABI. If that fails with an ABI
  // mismatch (e.g. binding was built for Electron 145 but we're running Node
  // 137), rebuild for the current Node ABI and retry.
  if (!tryLoadBinding()) {
    console.warn("⚠ better-sqlite3 binding ABI does not match current Node — rebuilding...");
    rebuild();
    if (!tryLoadBinding()) {
      console.error("✗ better-sqlite3 still does not load after rebuild");
      process.exit(1);
    }
    console.log("✓ rebuilt for current Node ABI");
  }

  // Beyond loading, do a real query to confirm the binding actually works.
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);");
    const row = db.prepare("SELECT x FROM t").get();
    db.close();
    if (row.x !== 1) throw new Error("row check failed");
    console.log("✓ better-sqlite3 loads + queries under Node", process.version);
  } catch (err) {
    console.error("✗ better-sqlite3 load/verify failed:");
    console.error(err.message);
    process.exit(1);
  }
}

function tryLoadBinding() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return true;
  } catch (err) {
    if (err && err.code === "ERR_DLOPEN_FAILED") return false;
    throw err;
  }
}

const cmd = process.argv[2] || "status";
switch (cmd) {
  case "status":
    status();
    break;
  case "rebuild":
    rebuild();
    break;
  case "rebuild-electron":
    rebuildForElectron();
    break;
  case "check":
    check();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error(
      "Usage: node scripts/sqlite-abi.js {status|rebuild|rebuild-electron|check}"
    );
    process.exit(2);
}
