<p align="center">
  <img src="src/assets/logo.svg" alt="SuperTing" width="120" />
</p>

<h1 align="center">SuperTing</h1>

<p align="center">
  <a href="https://github.com/sysusugan/superting/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sysusugan/superting?style=flat" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat" alt="Platform" />
  <a href="https://github.com/sysusugan/superting/releases/latest"><img src="https://img.shields.io/github/v/release/sysusugan/superting?style=flat&sort=semver" alt="GitHub release" /></a>
  <a href="https://github.com/sysusugan/superting/releases"><img src="https://img.shields.io/github/downloads/sysusugan/superting/total?style=flat&color=blue" alt="Downloads" /></a>
  <a href="https://github.com/sysusugan/superting/stargazers"><img src="https://img.shields.io/github/stars/sysusugan/superting?style=flat" alt="GitHub stars" /></a>
</p>

<p align="center">
  The open-source and free alternative to WisprFlow and Granola.<br/>
  Privacy-first voice-to-text dictation with AI agents, meeting transcription, and notes. Cross-platform for macOS, Windows, and Linux.
</p>

<p align="center">
  <a href="https://github.com/sysusugan/superting#readme">Docs</a> &middot;
  <a href="https://github.com/sysusugan/superting/releases/latest">Download</a> &middot;
  <a href="https://github.com/sysusugan/superting/blob/main/CHANGELOG.md">Changelog</a>
</p>

---

SuperTing turns your voice into text, notes, and actions from your desktop. Press a hotkey, speak, and your words appear at your cursor. Choose fully private offline transcription with local speech-to-text engines like Whisper and NVIDIA Parakeet, or bring your own provider API key. No data collection, no telemetry, fully open source.

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg`](https://github.com/sysusugan/superting/releases/latest) |
| macOS (Intel) | [`.dmg`](https://github.com/sysusugan/superting/releases/latest) |
| Windows | [`.exe`](https://github.com/sysusugan/superting/releases/latest) |
| Linux | [`.AppImage`](https://github.com/sysusugan/superting/releases/latest) / [`.deb`](https://github.com/sysusugan/superting/releases/latest) / [`.rpm`](https://github.com/sysusugan/superting/releases/latest) |

## Features

- **Voice dictation** — global hotkey to dictate into any app with automatic pasting
- **AI agent** — talk to GPT-5, Claude, Gemini, Groq, or local models with a named voice assistant
- **Meeting transcription** — auto-detect Zoom, Teams, and FaceTime calls with live speaker diarization and voice fingerprinting
- **Local speaker diarization** — on-device speaker labelling with voice fingerprint recognition across meetings, no cloud required
- **Notes** — create, organize, and search notes with folders, local semantic search, and AI actions
- **Local or BYOK — your choice** — core features work with local models or user-configured providers

## Quick start

```bash
git clone https://github.com/sysusugan/superting.git
cd superting
npm install
npm run dev
```

Requires Node.js 24+. See this repository for setup guides, platform-specific instructions, and build details.

## Documentation

Start with this README and the files in [`docs/`](docs/) for local development, platform notes, and troubleshooting.

## Tech stack

React 19, TypeScript, Tailwind CSS v4, Electron 41, better-sqlite3, whisper.cpp, sherpa-onnx, shadcn/ui

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=sysusugan/superting&type=date&legend=top-left)](https://www.star-history.com/#sysusugan/superting&type=date&legend=top-left)

## Contributing

We welcome contributions. Fork the repo, create a feature branch, and open a pull request.

## License

[MIT](LICENSE) — free for personal and commercial use.

## Acknowledgments

- **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)** — upstream MIT project this independent fork is based on
- **[OpenAI Whisper](https://github.com/openai/whisper)** — speech recognition model powering local and cloud transcription
- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** — high-performance C++ implementation for local processing
- **[NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)** — fast multilingual ASR model
- **[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)** — cross-platform ONNX runtime for Parakeet inference
- **[Hugging Face](https://huggingface.co/)** — model hub hosting Whisper, Parakeet, and embedding model weights
- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** — local LLM inference for AI text processing
- **[Electron](https://www.electronjs.org/)** — cross-platform desktop framework
- **[React](https://react.dev/)** — UI component library
- **[shadcn/ui](https://ui.shadcn.com/)** — accessible components built on Radix primitives
