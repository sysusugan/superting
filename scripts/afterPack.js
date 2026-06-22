// electron-builder afterPack hook
//
// Runs after electron-builder assembles the output directory but before the
// final installer (DMG/NSIS/AppImage) is created. Operates only on the output
// directory — never touches source node_modules/.
//
// 1. Strips non-target platform/arch binaries from onnxruntime-node
//    (saves 150–180 MB per build).
// 2. Prunes cross-platform resource binaries from resources/bin/
//    (saves ~350 MB on macOS arm64: removes Windows .exe, Linux ELF,
//    and Darwin x64 sidecars left by multi-platform download scripts).
// 3. Wraps the Linux binary in a shell script that forces XWayland and
//    reads user flags from ~/.config/superting-flags.conf.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Arch } = require("app-builder-lib");

// ---------------------------------------------------------------------------
// macOS resource binary signing
// ---------------------------------------------------------------------------

function resolveAppPath(context) {
  if (context.electronPlatformName !== "darwin") {
    return context.appOutDir;
  }

  if (context.appOutDir.endsWith(".app")) {
    return context.appOutDir;
  }

  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
}

function resolveResourcesDir(context) {
  return context.electronPlatformName === "darwin"
    ? path.join(resolveAppPath(context), "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
}

function collectFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function isMachOBinary(filePath) {
  try {
    const description = execFileSync("file", ["-b", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return description.includes("Mach-O");
  } catch {
    return false;
  }
}

function registerMacResourceBinariesForSigning(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const resourcesDir = resolveResourcesDir(context);
  const machOFiles = collectFiles(resourcesDir).filter(isMachOBinary);

  if (machOFiles.length === 0) {
    return;
  }

  const macConfig = context.packager.platformSpecificBuildOptions;
  const existingBinaries = Array.isArray(macConfig.binaries) ? macConfig.binaries : [];

  macConfig.binaries = [...new Set([...existingBinaries, ...machOFiles])];

  console.log(
    `  afterPack: registered ${machOFiles.length} Mach-O files under Contents/Resources for signing`
  );
}

// ---------------------------------------------------------------------------
// onnxruntime-node binary stripping
// ---------------------------------------------------------------------------

function stripOnnxruntimeBinaries(context) {
  const platform = context.electronPlatformName; // darwin | linux | win32
  const archName = Arch[context.arch]; // x64 | arm64 | ia32 | universal

  // Resolve the resources directory inside the packed output
  const resourcesDir = resolveResourcesDir(context);

  const onnxBinDir = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6"
  );

  if (!fs.existsSync(onnxBinDir)) return;

  // For universal macOS builds keep both arm64 and x64 under darwin/
  const keepArchs = archName === "universal" ? ["arm64", "x64"] : [archName];

  const platformDirs = fs.readdirSync(onnxBinDir);
  let totalRemoved = 0;

  for (const dir of platformDirs) {
    const fullPath = path.join(onnxBinDir, dir);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    if (dir !== platform) {
      // Wrong platform — remove entirely
      fs.rmSync(fullPath, { recursive: true, force: true });
      totalRemoved++;
      continue;
    }

    // Right platform — strip non-target architectures
    const archDirs = fs.readdirSync(fullPath);
    for (const arch of archDirs) {
      const archPath = path.join(fullPath, arch);
      if (!fs.statSync(archPath).isDirectory()) continue;
      if (!keepArchs.includes(arch)) {
        fs.rmSync(archPath, { recursive: true, force: true });
        totalRemoved++;
      }
    }
  }

  if (totalRemoved > 0) {
    console.log(
      `  afterPack: stripped ${totalRemoved} non-target onnxruntime-node directories (keeping ${platform}/${keepArchs.join(",")})`
    );
  }
}

function findNodeOnnxruntimeLibrary(context) {
  const platform = context.electronPlatformName;
  const archName = Arch[context.arch];
  const resourcesDir = resolveResourcesDir(context);

  if (!["darwin", "linux"].includes(platform)) {
    return null;
  }

  const onnxPlatformArchDir = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6",
    platform,
    archName
  );

  if (!fs.existsSync(onnxPlatformArchDir)) {
    return null;
  }

  const pattern =
    platform === "darwin" ? /^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/ : /^libonnxruntime\.so\.\d+$/;

  return (
    fs
      .readdirSync(onnxPlatformArchDir)
      .filter((file) => pattern.test(file))
      .map((file) => path.join(onnxPlatformArchDir, file))
      .sort()
      .pop() || null
  );
}

function linkResourceOnnxruntimeToNodeModule(context) {
  const platform = context.electronPlatformName;

  if (!["darwin", "linux"].includes(platform)) {
    return;
  }

  const resourcesDir = resolveResourcesDir(context);
  const binDir = path.join(resourcesDir, "bin");

  if (!fs.existsSync(binDir)) {
    return;
  }

  const nodeOnnxruntimePath = findNodeOnnxruntimeLibrary(context);

  if (!nodeOnnxruntimePath) {
    console.warn(
      "  afterPack: onnxruntime-node library not found; leaving resource libraries intact"
    );
    return;
  }

  const resourceLibraryPattern =
    platform === "darwin"
      ? /^libonnxruntime(?:\.\d+\.\d+\.\d+)?\.dylib$/
      : /^libonnxruntime\.so(?:\.\d+)?$/;

  const resourceLibraries = fs
    .readdirSync(binDir)
    .filter((file) => resourceLibraryPattern.test(file));

  if (resourceLibraries.length === 0) {
    return;
  }

  const relativeTarget = path.relative(binDir, nodeOnnxruntimePath);

  for (const libraryName of resourceLibraries) {
    const libraryPath = path.join(binDir, libraryName);
    fs.rmSync(libraryPath, { force: true });
    fs.symlinkSync(relativeTarget, libraryPath);
  }

  console.log(
    `  afterPack: linked ${resourceLibraries.length} resource onnxruntime libraries to ${path.basename(nodeOnnxruntimePath)}`
  );
}

// ---------------------------------------------------------------------------
// Linux XWayland wrapper
// ---------------------------------------------------------------------------

function wrapLinuxBinary(context) {
  if (context.electronPlatformName !== "linux") return;

  const appDir = context.appOutDir;
  const binaryName = context.packager.executableName;
  const binaryPath = path.join(appDir, binaryName);
  const realBinaryPath = path.join(appDir, binaryName + "-app");

  fs.renameSync(binaryPath, realBinaryPath);

  const wrapper = `#!/bin/bash
# SuperTing launcher
# User flags: ~/.config/${binaryName}-flags.conf (one per line, # = comment)

HERE="$(dirname "$(readlink -f "\${BASH_SOURCE[0]}")")"
FLAGS=()

# Wayland: forces XWayland (overlay positioning requires X11)
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
  FLAGS+=(--ozone-platform=x11)
fi

# User flags
FLAGS_FILE="\${XDG_CONFIG_HOME:-$HOME/.config}/${binaryName}-flags.conf"
if [ -f "$FLAGS_FILE" ]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    FLAGS+=("$line")
  done < "$FLAGS_FILE"
fi

exec -a "$0" "$HERE/${binaryName}-app" "\${FLAGS[@]}" "$@"
`;

  fs.writeFileSync(binaryPath, wrapper, { mode: 0o755 });
}

function verifyMeetingAecHelper(context) {
  const platform = context.electronPlatformName;
  const archName = Arch[context.arch];

  if (!["darwin", "linux", "win32"].includes(platform)) {
    return;
  }

  const binaryName = `meeting-aec-helper-${platform}-${archName}${platform === "win32" ? ".exe" : ""}`;
  const resourcesDir = resolveResourcesDir(context);
  const binaryPath = path.join(resourcesDir, "bin", binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.warn(`  afterPack: missing optional meeting AEC helper (${binaryName})`);
    return;
  }

  if (platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }
}

// ---------------------------------------------------------------------------
// Cross-platform resource binary pruning
// ---------------------------------------------------------------------------
//
// electron-builder's `files` / `extraResources` config doesn't filter
// `resources/bin/` by platform, so a macOS build ends up shipping the
// Windows .exe, Linux ELF, and Darwin x64 binaries that the download
// scripts (run with --all for cross-platform CI) left in the tree.
//
// This pass walks `Contents/Resources/bin/` (or `resources/bin/`) and
// removes every file that is not a match for the target platform/arch.
// Saves ~350MB on a typical macOS arm64 build.
//
// Rules:
//   - Directory entries are left untouched (diarization-models/ and
//     whisper-vad/ contain platform-agnostic ONNX/GGML models used by all
//     three platforms; .swift-module-cache/ is a build artifact).
//   - File extension is a hard platform signal: .dylib => darwin only,
//     .so* => linux only, .dll => win32 only. Files with no extension or
//     "platform-neutral" names (e.g. macos-globe-listener, which lacks
//     an arch suffix) are matched by an explicit platform-prefix allow
//     list per target.
//   - Files carrying a `-<platform>-<arch>` infix keep only the target
//     platform+arch pair.

const PLATFORM_TOKEN = ["darwin", "linux", "win32"];

function getPrunablePlatformFromName(fileName) {
  // Order matters: check darwin first because "darwin" is a substring of
  // nothing else here, but linux/win32 don't conflict either.
  if (fileName.includes("-darwin-")) return "darwin";
  if (fileName.includes("-linux-")) return "linux";
  if (fileName.includes("-win32-")) return "win32";
  return null;
}

function getPrunableArchFromName(fileName) {
  if (fileName.includes("-arm64")) return "arm64";
  if (fileName.includes("-x64") || fileName.includes("-x86_64") || fileName.includes("-ia32")) {
    // Multiple suffixes can map to x64: "-x64", "-x86_64"; "ia32" is also
    // 32-bit x86 which we keep alongside x64 because whisper.cpp's
    // Windows .dll tree only ships x64 today, so this is a no-op there.
    return "x64";
  }
  return null;
}

function shouldKeepResourceBinary(fileName, platform, archName) {
  // 1. Extension-based filter (covers libs that don't carry a platform
  //    infix in their name: libonnxruntime.*, libggml-*, libllama*, etc.)
  if (fileName.endsWith(".dylib")) {
    if (platform !== "darwin") return false;
  } else if (fileName.endsWith(".dll")) {
    if (platform !== "win32") return false;
  } else if (/\.so(\.|$)/.test(fileName)) {
    if (platform !== "linux") return false;
  }

  // 2. Platform-infix filter (covers qdrant, llama-server, whisper-server,
  //    sherpa-onnx, meeting-aec-helper).
  const infixPlatform = getPrunablePlatformFromName(fileName);
  if (infixPlatform) {
    if (infixPlatform !== platform) return false;

    // Right platform — also check arch if the name carries one.
    if (archName !== "universal") {
      const infixArch = getPrunableArchFromName(fileName);
      if (infixArch && infixArch !== archName) return false;
    }
  }

  // 3. Bare-platform prefix filter (macos-*, linux-*, windows-*) for
  //    native helpers that lack an arch suffix.
  if (platform !== "darwin" && fileName.startsWith("macos-")) return false;
  if (platform !== "linux" && fileName.startsWith("linux-")) return false;
  if (platform !== "win32" && fileName.startsWith("windows-")) return false;
  if (platform !== "win32" && fileName.endsWith(".exe")) return false;

  return true;
}

function pruneCrossPlatformBinaries(context) {
  const platform = context.electronPlatformName; // darwin | linux | win32
  const archName = Arch[context.arch]; // x64 | arm64 | universal

  if (!PLATFORM_TOKEN.includes(platform)) {
    return;
  }

  const resourcesDir = resolveResourcesDir(context);
  const binDir = path.join(resourcesDir, "bin");

  if (!fs.existsSync(binDir)) {
    return;
  }

  let removedCount = 0;
  let keptCount = 0;

  for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // diarization-models/, whisper-vad/, .swift-module-cache/ — leave as-is.
      continue;
    }

    if (entry.isFile() && !shouldKeepResourceBinary(entry.name, platform, archName)) {
      fs.rmSync(path.join(binDir, entry.name), { force: true });
      removedCount++;
      continue;
    }

    keptCount++;
  }

  if (removedCount > 0) {
    console.log(
      `  afterPack: pruned ${removedCount} non-target resource binaries from bin/ (kept ${keptCount} for ${platform}/${archName})`
    );
  }
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

exports.default = async function (context) {
  pruneCrossPlatformBinaries(context);
  stripOnnxruntimeBinaries(context);
  linkResourceOnnxruntimeToNodeModule(context);
  wrapLinuxBinary(context);
  verifyMeetingAecHelper(context);
  registerMacResourceBinariesForSigning(context);
};
