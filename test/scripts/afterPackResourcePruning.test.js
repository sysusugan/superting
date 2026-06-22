const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// afterPack.js does `Arch[context.arch]` to derive an arch name string;
// pass the same numeric enum values electron-builder does so the rest of
// the afterPack pipeline (onnxruntime symlinking, Linux wrapper, etc.)
// behaves identically to a real build invocation.
const { Arch } = require("app-builder-lib");

const afterPack = require("../../scripts/afterPack.js");

// Synthesize a resources/bin/ tree that mirrors the real one when
// download:qdrant --all, download:llama-server --all, etc. have been
// run: a mix of darwin / linux / win32 binaries and a directory of
// platform-agnostic ONNX models that must be preserved.
function seedBinDir(binDir) {
  const files = [
    // qdrant
    "qdrant-darwin-arm64",
    "qdrant-darwin-x64",
    "qdrant-linux-x64",
    "qdrant-win32-x64.exe",
    // llama-server
    "llama-server-darwin-arm64",
    "llama-server-darwin-x64",
    "llama-server-linux-x64-cpu",
    "llama-server-win32-x64-cpu.exe",
    // whisper-server
    "whisper-server-darwin-arm64",
    "whisper-server-darwin-x64",
    "whisper-server-linux-x64",
    "whisper-server-win32-x64.exe",
    // sherpa-onnx (compound name pattern)
    "sherpa-onnx-ws-darwin-arm64",
    "sherpa-onnx-ws-darwin-x64",
    "sherpa-onnx-ws-linux-x64",
    "sherpa-onnx-ws-win32-x64.exe",
    "sherpa-onnx-diarize-darwin-arm64",
    "sherpa-onnx-diarize-linux-x64",
    "sherpa-onnx-diarize-win32-x64.exe",
    // meeting-aec-helper
    "meeting-aec-helper-darwin-arm64",
    "meeting-aec-helper-darwin-x64",
    "meeting-aec-helper-linux-x64",
    "meeting-aec-helper-win32-x64.exe",
    // macos native helpers (no arch suffix)
    "macos-globe-listener",
    "macos-mic-listener",
    "macos-fast-paste",
    "macos-audio-tap",
    "macos-text-monitor",
    "macos-media-remote",
    // windows native helpers
    "windows-key-listener.exe",
    "windows-mic-listener.exe",
    "windows-text-monitor.exe",
    "windows-fast-paste.exe",
    "nircmd.exe",
    // linux native helpers
    "linux-fast-paste",
    "linux-key-listener",
    "linux-system-audio-helper",
    "linux-text-monitor",
    // libraries (no platform infix, only the extension signals platform)
    "libonnxruntime.1.23.2.dylib",
    "libonnxruntime.so",
    "onnxruntime.dll",
    "libggml-base.dylib",
    "libggml-base.so",
    "ggml-base.dll",
    "libggml-cpu-alderlake.dylib",
    "libggml-cpu-alderlake.so",
    "ggml-cpu-alderlake.dll",
    "libllama.dylib",
    "libllama.so",
    "libllama-common.dylib",
    "libllama-common.so",
    "llama-common.dll",
    "libsherpa-onnx-c-api.dylib",
    "libsherpa-onnx-c-api.so",
    "sherpa-onnx-c-api.dll",
    // platform-agnostic stub (cargs.dll is windows-only by extension)
    "cargs.dll",
  ];

  for (const file of files) {
    const filePath = path.join(binDir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "");
  }

  // Platform-agnostic model directories — must survive every prune.
  fs.mkdirSync(path.join(binDir, "diarization-models"), { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "diarization-models", "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"),
    ""
  );
  fs.writeFileSync(path.join(binDir, "diarization-models", "silero_vad.onnx"), "");

  fs.mkdirSync(path.join(binDir, "diarization-models", "sherpa-onnx-pyannote-segmentation-3-0"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(binDir, "diarization-models", "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx"),
    ""
  );

  fs.mkdirSync(path.join(binDir, "whisper-vad"), { recursive: true });
  fs.writeFileSync(path.join(binDir, "whisper-vad", "ggml-silero-v5.1.2.bin"), "");
}

function makeContext(platform, arch, appOutDir) {
  return {
    electronPlatformName: platform,
    arch,
    appOutDir,
    packager: {
      appInfo: { productFilename: "SuperTing" },
      executableName: "superting",
      platformSpecificBuildOptions: {},
    },
  };
}

function makeTempWorkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "superting-prune-"));
}

function expectedKept(binDir, names) {
  for (const name of names) {
    assert.equal(fs.existsSync(path.join(binDir, name)), true, `expected kept: ${name}`);
  }
}

function expectedRemoved(binDir, names) {
  for (const name of names) {
    assert.equal(fs.existsSync(path.join(binDir, name)), false, `expected removed: ${name}`);
  }
}

test("pruneCrossPlatformBinaries: macOS arm64 keeps darwin-arm64 only", async () => {
  const tempDir = makeTempWorkdir();
  const binDir = path.join(tempDir, "SuperTing.app", "Contents", "Resources", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  seedBinDir(binDir);

  try {
    await afterPack.default(makeContext("darwin", Arch.arm64, tempDir));

    expectedKept(binDir, [
      // sidecars
      "qdrant-darwin-arm64",
      "llama-server-darwin-arm64",
      "whisper-server-darwin-arm64",
      "sherpa-onnx-ws-darwin-arm64",
      "sherpa-onnx-diarize-darwin-arm64",
      "meeting-aec-helper-darwin-arm64",
      // macos-* helpers
      "macos-globe-listener",
      "macos-mic-listener",
      "macos-fast-paste",
      "macos-audio-tap",
      "macos-text-monitor",
      "macos-media-remote",
      // dylib libraries
      "libonnxruntime.1.23.2.dylib",
      "libggml-base.dylib",
      "libggml-cpu-alderlake.dylib",
      "libllama.dylib",
      "libllama-common.dylib",
      "libsherpa-onnx-c-api.dylib",
      // platform-agnostic dirs
      "diarization-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
      "diarization-models/silero_vad.onnx",
      "diarization-models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
      "whisper-vad/ggml-silero-v5.1.2.bin",
    ]);

    expectedRemoved(binDir, [
      // wrong-arch sidecars
      "qdrant-darwin-x64",
      "llama-server-darwin-x64",
      "whisper-server-darwin-x64",
      "sherpa-onnx-ws-darwin-x64",
      "sherpa-onnx-diarize-darwin-x64",
      "meeting-aec-helper-darwin-x64",
      // linux + win32 sidecars
      "qdrant-linux-x64",
      "qdrant-win32-x64.exe",
      "llama-server-linux-x64-cpu",
      "llama-server-win32-x64-cpu.exe",
      "whisper-server-linux-x64",
      "whisper-server-win32-x64.exe",
      "sherpa-onnx-ws-linux-x64",
      "sherpa-onnx-ws-win32-x64.exe",
      "sherpa-onnx-diarize-linux-x64",
      "sherpa-onnx-diarize-win32-x64.exe",
      "meeting-aec-helper-linux-x64",
      "meeting-aec-helper-win32-x64.exe",
      // wrong-platform native helpers
      "windows-key-listener.exe",
      "windows-mic-listener.exe",
      "windows-text-monitor.exe",
      "windows-fast-paste.exe",
      "nircmd.exe",
      "linux-fast-paste",
      "linux-key-listener",
      "linux-system-audio-helper",
      "linux-text-monitor",
      // .so + .dll libraries (wrong platform)
      "libonnxruntime.so",
      "onnxruntime.dll",
      "libggml-base.so",
      "ggml-base.dll",
      "libggml-cpu-alderlake.so",
      "ggml-cpu-alderlake.dll",
      "libllama.so",
      "libllama-common.so",
      "llama-common.dll",
      "libsherpa-onnx-c-api.so",
      "sherpa-onnx-c-api.dll",
      "cargs.dll",
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pruneCrossPlatformBinaries: linux x64 keeps linux-x64 only", async () => {
  const tempDir = makeTempWorkdir();
  // Linux: contents live directly under appOutDir/resources/bin (not in a .app bundle)
  const binDir = path.join(tempDir, "resources", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  seedBinDir(binDir);

  // wrapLinuxBinary (an existing afterPack hook) renames the linux
  // launcher binary — fabricate an empty stub so it has something to
  // rename. This test is only about pruneCrossPlatformBinaries; the
  // launcher wrapper is exercised by real builds.
  fs.writeFileSync(path.join(tempDir, "superting"), "");

  try {
    await afterPack.default(makeContext("linux", Arch.x64, tempDir));

    expectedKept(binDir, [
      "qdrant-linux-x64",
      "llama-server-linux-x64-cpu",
      "whisper-server-linux-x64",
      "sherpa-onnx-ws-linux-x64",
      "sherpa-onnx-diarize-linux-x64",
      "meeting-aec-helper-linux-x64",
      "linux-fast-paste",
      "linux-key-listener",
      "linux-system-audio-helper",
      "linux-text-monitor",
      "libonnxruntime.so",
      "libggml-base.so",
      "libggml-cpu-alderlake.so",
      "libllama.so",
      "libllama-common.so",
      "libsherpa-onnx-c-api.so",
    ]);

    expectedRemoved(binDir, [
      // all darwin + win32 sidecars
      "qdrant-darwin-arm64",
      "qdrant-darwin-x64",
      "qdrant-win32-x64.exe",
      "llama-server-darwin-arm64",
      "llama-server-darwin-x64",
      "llama-server-win32-x64-cpu.exe",
      "whisper-server-darwin-arm64",
      "whisper-server-darwin-x64",
      "whisper-server-win32-x64.exe",
      "sherpa-onnx-ws-darwin-arm64",
      "sherpa-onnx-ws-darwin-x64",
      "sherpa-onnx-ws-win32-x64.exe",
      "sherpa-onnx-diarize-darwin-arm64",
      "sherpa-onnx-diarize-darwin-x64",
      "sherpa-onnx-diarize-win32-x64.exe",
      "meeting-aec-helper-darwin-arm64",
      "meeting-aec-helper-darwin-x64",
      "meeting-aec-helper-win32-x64.exe",
      "macos-globe-listener",
      "macos-mic-listener",
      "macos-fast-paste",
      "macos-audio-tap",
      "macos-text-monitor",
      "macos-media-remote",
      "windows-key-listener.exe",
      "nircmd.exe",
      // .dylib + .dll libraries
      "libonnxruntime.1.23.2.dylib",
      "libggml-base.dylib",
      "libggml-cpu-alderlake.dylib",
      "libllama.dylib",
      "libllama-common.dylib",
      "libsherpa-onnx-c-api.dylib",
      "onnxruntime.dll",
      "ggml-base.dll",
      "ggml-cpu-alderlake.dll",
      "llama-common.dll",
      "sherpa-onnx-c-api.dll",
      "cargs.dll",
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pruneCrossPlatformBinaries: win32 x64 keeps win32-x64 only", async () => {
  const tempDir = makeTempWorkdir();
  const binDir = path.join(tempDir, "resources", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  seedBinDir(binDir);

  try {
    await afterPack.default(makeContext("win32", Arch.x64, tempDir));

    expectedKept(binDir, [
      "qdrant-win32-x64.exe",
      "llama-server-win32-x64-cpu.exe",
      "whisper-server-win32-x64.exe",
      "sherpa-onnx-ws-win32-x64.exe",
      "sherpa-onnx-diarize-win32-x64.exe",
      "meeting-aec-helper-win32-x64.exe",
      "windows-key-listener.exe",
      "windows-mic-listener.exe",
      "windows-text-monitor.exe",
      "windows-fast-paste.exe",
      "nircmd.exe",
      "onnxruntime.dll",
      "ggml-base.dll",
      "ggml-cpu-alderlake.dll",
      "llama-common.dll",
      "sherpa-onnx-c-api.dll",
      "cargs.dll",
    ]);

    expectedRemoved(binDir, [
      "qdrant-darwin-arm64",
      "qdrant-darwin-x64",
      "qdrant-linux-x64",
      "llama-server-darwin-arm64",
      "llama-server-darwin-x64",
      "llama-server-linux-x64-cpu",
      "whisper-server-darwin-arm64",
      "whisper-server-darwin-x64",
      "whisper-server-linux-x64",
      "sherpa-onnx-ws-darwin-arm64",
      "sherpa-onnx-ws-darwin-x64",
      "sherpa-onnx-ws-linux-x64",
      "sherpa-onnx-diarize-darwin-arm64",
      "sherpa-onnx-diarize-darwin-x64",
      "sherpa-onnx-diarize-linux-x64",
      "meeting-aec-helper-darwin-arm64",
      "meeting-aec-helper-darwin-x64",
      "meeting-aec-helper-linux-x64",
      "macos-globe-listener",
      "macos-mic-listener",
      "macos-fast-paste",
      "macos-audio-tap",
      "macos-text-monitor",
      "macos-media-remote",
      "linux-fast-paste",
      "linux-key-listener",
      "linux-system-audio-helper",
      "linux-text-monitor",
      // .dylib + .so libraries
      "libonnxruntime.1.23.2.dylib",
      "libggml-base.dylib",
      "libggml-cpu-alderlake.dylib",
      "libllama.dylib",
      "libllama-common.dylib",
      "libsherpa-onnx-c-api.dylib",
      "libonnxruntime.so",
      "libggml-base.so",
      "libggml-cpu-alderlake.so",
      "libllama.so",
      "libllama-common.so",
      "libsherpa-onnx-c-api.so",
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pruneCrossPlatformBinaries: dirs are not recursed or removed", async () => {
  const tempDir = makeTempWorkdir();
  const binDir = path.join(tempDir, "SuperTing.app", "Contents", "Resources", "bin");
  fs.mkdirSync(path.join(binDir, "diarization-models"), { recursive: true });
  fs.writeFileSync(path.join(binDir, "diarization-models", "should-survive.onnx"), "");

  try {
    await afterPack.default(makeContext("darwin", Arch.arm64, tempDir));

    assert.equal(
      fs.existsSync(path.join(binDir, "diarization-models", "should-survive.onnx")),
      true,
      "diarization-models/ contents must survive pruning"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
