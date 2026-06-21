---
name: superting-api
description: Use SuperTing's local loopback API exposed by a running desktop app.
---

# SuperTing Local API

SuperTing exposes a local-only HTTP bridge for automation. It is intended for
desktop-local tools, MCP adapters, and agent skills that need to read or modify
the user's local notes and transcription history.

## Connection

The desktop app writes bridge metadata to:

```sh
~/.superting/cli-bridge.json
```

Read the current port and bearer token from that file:

```sh
bridge="${HOME}/.superting/cli-bridge.json"
port="$(jq -r .port "$bridge")"
token="$(jq -r .token "$bridge")"
base_url="http://127.0.0.1:${port}"
```

All requests must include:

```sh
Authorization: Bearer $token
```

The bridge only binds to `127.0.0.1` and is not a hosted service. It does not
require an SuperTing account.

## Routes

- `GET /v1/health`
- `GET /v1/notes/list?limit=100&folder_id=<id>&note_type=<type>`
- `GET /v1/notes/search?q=<query>&limit=20`
- `GET /v1/notes/<id>`
- `POST /v1/notes/create`
- `PATCH /v1/notes/<id>`
- `DELETE /v1/notes/<id>`
- `GET /v1/folders/list`
- `POST /v1/folders/create`
- `GET /v1/dictionary`
- `GET /v1/dictionary/aliases`
- `GET /v1/transcriptions/list?limit=50`
- `GET /v1/transcriptions/<id>`
- `DELETE /v1/transcriptions/<id>`
- `DELETE /v1/transcriptions/<id>/audio`

## Examples

Health check:

```sh
curl -sS \
  -H "Authorization: Bearer ${token}" \
  "${base_url}/v1/health"
```

Search local notes:

```sh
curl -sS \
  -H "Authorization: Bearer ${token}" \
  "${base_url}/v1/notes/search?q=meeting&limit=5"
```

Create a local note:

```sh
curl -sS \
  -X POST \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Draft","content":"Local note","note_type":"personal"}' \
  "${base_url}/v1/notes/create"
```

## MCP Adapter Guidance

If an MCP server or tool adapter is used, it should wrap this local bridge and
keep the same local trust boundary:

- Read the bridge file at runtime.
- Connect only to `127.0.0.1`.
- Pass the bearer token in memory.
- Do not add telemetry or remote synchronization.
- Surface bridge-not-running errors clearly so the user can start the desktop app.
