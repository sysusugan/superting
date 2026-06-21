---
name: superting-cli
description: Use the local SuperTing CLI against the desktop app's loopback bridge.
---

# SuperTing Local CLI

Use this skill when a task should operate on the user's local SuperTing desktop
data through the CLI. The CLI is a local client for the desktop loopback bridge.
It should not require a hosted account.

## Preconditions

1. SuperTing desktop is running.
2. The bridge file exists at `~/.superting/cli-bridge.json`.
3. The CLI is installed and available on `PATH`.

Check the CLI:

```sh
superting --version
superting --help
```

Check the local bridge directly when diagnosing CLI issues:

```sh
bridge="${HOME}/.superting/cli-bridge.json"
port="$(jq -r .port "$bridge")"
token="$(jq -r .token "$bridge")"
curl -sS -H "Authorization: Bearer ${token}" "http://127.0.0.1:${port}/v1/health"
```

## Local Workflows

Prefer CLI commands for common local workflows when the installed CLI supports
them:

```sh
superting --local notes list
superting --local notes search "meeting"
superting --local transcriptions list
```

If the installed CLI does not expose a command for the needed operation, use the
local API bridge directly via the `superting-api` skill pattern.

## Design Rules

- Keep all data local to the desktop app and local bridge.
- Do not introduce login, hosted sync, payment, telemetry, or remote account flows.
- For MCP use cases, wrap the local CLI or local bridge rather than calling a
  hosted SuperTing endpoint.
- Preserve user data ownership: read from local SQLite-backed APIs and write
  through the desktop app bridge so normal UI refresh and vector indexing still run.
