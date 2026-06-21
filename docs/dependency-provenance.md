# SuperTing Dependency Provenance

This document tracks external binary and model sources used by the desktop app.
It separates SuperTing-owned release artifacts from third-party model/runtime
dependencies.

## SuperTing-Controlled Release Artifacts

These helper binaries are built from this repository and downloaded from the
configured release repository:

- `meeting-aec-helper-*`: `scripts/download-meeting-aec-helper.js`
- `linux-text-monitor`: `scripts/download-text-monitor.js`
- `windows-text-monitor.exe`: `scripts/download-text-monitor.js`
- `windows-fast-paste.exe`: `scripts/download-windows-fast-paste.js`
- `windows-key-listener.exe`: `scripts/download-windows-key-listener.js`
- `windows-mic-listener.exe`: `scripts/download-windows-mic-listener.js`

During the pre-rename cutover, the default release repository is
`sysusugan/openwhispr`. Override it with `SUPERTING_RELEASE_REPO`. After the
GitHub repository is renamed, change the default to `sysusugan/superting`.

## Whisper Server Runtime

- `whisper-server-*`: `scripts/download-whisper-cpp.js`
- CUDA whisper server: `src/helpers/whisperCudaManager.js`

The default repository is `sysusugan/whisper.cpp`. Override it with
`SUPERTING_WHISPER_CPP_REPO` when testing a different fork or pinned release.

## Third-Party Runtime Binaries

- `llama-server-*`: `ggerganov/llama.cpp`, pinned by `LLAMA_CPP_VERSION`
  defaulting to `b8857`.
- `sherpa-onnx-*`: `k2-fsa/sherpa-onnx`, pinned by `SHERPA_ONNX_VERSION`.
- `qdrant-*`: `qdrant/qdrant`, optionally pinned by `QDRANT_VERSION`.
- `nircmd.exe`: NirSoft `nircmd-x64.zip`.

## Third-Party Model Files

- Whisper GGML models: `huggingface.co/ggerganov/whisper.cpp`.
- Whisper VAD model: `huggingface.co/ggml-org/whisper-vad`.
- MiniLM embedding model: `sentence-transformers/all-MiniLM-L6-v2`.
- Parakeet ASR models: `k2-fsa/sherpa-onnx` ASR model releases.
- Diarization segmentation, embedding, and VAD models: `k2-fsa/sherpa-onnx`
  speaker and ASR model releases.

These are not OpenWhispr-owned dependencies. Keep their source URLs explicit so
model provenance remains auditable.
