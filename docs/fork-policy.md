# SuperTing Fork Policy

SuperTing is an independent fork based on the MIT-licensed OpenWhispr project.
The fork keeps upstream attribution, but does not treat `OpenWhispr/openwhispr`
as an upstream branch for routine merges or rebases.

The repository lives at `sysusugan/superting`. It started as an MIT-licensed
fork of `OpenWhispr/openwhispr`; after the rebrand it remains a fork of that
upstream but is published under its own GitHub identity.

## Maintenance Rules

- Keep product identity, app identifiers, protocols, local data paths, MCP
  metadata, and release downloads under SuperTing names.
- Do not add a permanent `upstream` remote for `OpenWhispr/openwhispr`.
- Use upstream code only through explicit cherry-picks or manually reviewed
  patches.
- Keep OpenWhispr attribution and MIT license notices intact.
- Prefer local-first and BYOK behavior unless a SuperTing-owned hosted service is
  explicitly introduced.
