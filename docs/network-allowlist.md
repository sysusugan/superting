# Network Allowlist

Outbound hosts the SuperTing desktop app may contact in the open-source build.
All connections are client-initiated over TLS. No inbound ports are required.

## Required by default

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `github.com`, `objects.githubusercontent.com` | HTTPS | 443 | Application auto-update and native/model sidecar release artifacts. |

## Local Model Downloads

Contacted only when a user opts into a local model.

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `huggingface.co` | HTTPS | 443 | Whisper GGML, Parakeet, GGUF, and embedding model downloads. |
| `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.huggingface.co` | HTTPS | 443 | Hugging Face large-file CDN. |
| `github.com`, `objects.githubusercontent.com` | HTTPS | 443 | sherpa-onnx, llama.cpp, whisper.cpp, and Qdrant binaries. |

## Optional BYOK Providers

Required only when a user configures their own API key for the corresponding
provider. Skip any provider not in use.

| Host | Protocol | Port | Used when |
| --- | --- | --- | --- |
| `api.openai.com` | WSS, HTTPS | 443 | OpenAI API key configured for transcription, streaming, or reasoning. |
| `api.anthropic.com` | HTTPS | 443 | Anthropic API key configured. |
| `generativelanguage.googleapis.com` | HTTPS | 443 | Gemini API key configured. |
| `api.groq.com` | HTTPS | 443 | Groq API key configured. |
| `api.mistral.ai` | HTTPS | 443 | Mistral API key configured. |
| `api.deepgram.com` | WSS | 443 | Deepgram streaming configured. |
| `streaming.assemblyai.com` | WSS, HTTPS | 443 | AssemblyAI streaming configured. |

## Notes

- The app uses Electron's network stack, which honors system proxy settings.
- IP pinning is not supported because provider-managed IPs can change without notice.
- On minimal Linux containers without a system CA bundle, set `NODE_EXTRA_CA_CERTS`.
