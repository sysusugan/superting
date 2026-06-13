const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const McpServerManager = require("../../src/helpers/mcpServerManager");

function createTempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-mcp-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createIpcHandlers() {
  const notes = new Map([
    [
      1,
      {
        id: 1,
        title: "Weekly plan",
        content: "Ship local MCP access",
        enhanced_content: "",
        note_type: "personal",
        folder_id: 2,
        created_at: "2026-06-13T01:00:00.000Z",
        updated_at: "2026-06-13T01:00:00.000Z",
        deleted_at: null,
      },
    ],
  ]);
  const folders = [{ id: 2, name: "Work", deleted_at: null }];
  let nextNoteId = 2;

  return {
    databaseManager: {
      getNotes: () => Array.from(notes.values()).filter((note) => !note.deleted_at),
      searchNotes: (query, limit = 20) =>
        Array.from(notes.values())
          .filter((note) => !note.deleted_at && note.title.includes(query))
          .slice(0, limit),
      getNote: (id) => notes.get(id) || null,
      saveNote: (title, content, noteType, sourceFile, audioDuration, folderId) => {
        const note = {
          id: nextNoteId++,
          title,
          content,
          enhanced_content: "",
          note_type: noteType,
          source_file: sourceFile,
          audio_duration_seconds: audioDuration,
          folder_id: folderId,
          created_at: "2026-06-13T02:00:00.000Z",
          updated_at: "2026-06-13T02:00:00.000Z",
          deleted_at: null,
        };
        notes.set(note.id, note);
        return { success: true, note };
      },
      updateNote: (id, updates) => {
        const note = notes.get(id);
        if (!note || note.deleted_at) return { success: false, error: "Note not found" };
        Object.assign(note, updates, { updated_at: "2026-06-13T03:00:00.000Z" });
        return { success: true, note };
      },
      getFolders: () => folders,
      createFolder: (name) => {
        const folder = { id: folders.length + 1, name, deleted_at: null };
        folders.push(folder);
        return { success: true, folder };
      },
      getTranscriptions: () => [
        {
          id: 10,
          text: "Meeting transcript",
          timestamp: "2026-06-13T04:00:00.000Z",
          has_audio: 1,
          audio_duration_ms: 42000,
          deleted_at: null,
        },
      ],
      getTranscriptionById: (id) =>
        id === 10
          ? {
              id: 10,
              text: "Meeting transcript",
              timestamp: "2026-06-13T04:00:00.000Z",
              has_audio: 1,
              audio_duration_ms: 42000,
              deleted_at: null,
            }
          : null,
      getDictionary: () => ["OpenWhispr"],
      getDictionaryAliases: () => [{ from: "Open Whisper", to: "OpenWhispr" }],
    },
    broadcastToWindows: () => {},
    _asyncVectorUpsert: () => {},
    _asyncMirrorWrite: () => {},
    deleteNoteInternal: (id) => {
      const note = notes.get(id);
      if (!note || note.deleted_at) return { success: false, error: "Note not found" };
      note.deleted_at = "2026-06-13T05:00:00.000Z";
      return { success: true, id };
    },
  };
}

async function createClient(url, token) {
  const client = new Client({ name: "openwhispr-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

test("MCP server stays stopped until explicitly enabled", async (t) => {
  const homeDir = createTempHome(t);
  const manager = new McpServerManager(createIpcHandlers(), { homeDir, portRange: [18720, 18729] });

  assert.deepEqual(manager.getStatus(), {
    enabled: false,
    running: false,
    url: null,
    port: null,
    hasToken: false,
  });
  assert.equal(fs.existsSync(path.join(homeDir, ".openwhispr", "mcp-server.json")), false);
});

test("MCP server exposes authenticated tools over Streamable HTTP", async (t) => {
  const homeDir = createTempHome(t);
  const manager = new McpServerManager(createIpcHandlers(), { homeDir, portRange: [18730, 18739] });
  t.after(async () => manager.stop());

  await manager.setEnabled(true);
  const status = manager.getStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.running, true);
  assert.ok(status.url);
  assert.equal(status.hasToken, true);

  const metadataPath = path.join(homeDir, ".openwhispr", "mcp-server.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.url, status.url);
  assert.equal(metadata.token.length, 64);

  const { client } = await createClient(status.url, metadata.token);
  t.after(async () => client.close());

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "openwhispr_search_notes"));

  const result = await client.callTool({
    name: "openwhispr_search_notes",
    arguments: { query: "Weekly", limit: 5 },
  });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, true);
  assert.equal(payload.data[0].title, "Weekly plan");
});

test("MCP server rejects requests without the bearer token", async (t) => {
  const homeDir = createTempHome(t);
  const manager = new McpServerManager(createIpcHandlers(), { homeDir, portRange: [18740, 18749] });
  t.after(async () => manager.stop());

  await manager.setEnabled(true);
  const status = manager.getStatus();
  const response = await fetch(status.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  assert.equal(response.status, 401);
});

test("MCP server exposes note write tools", async (t) => {
  const homeDir = createTempHome(t);
  const manager = new McpServerManager(createIpcHandlers(), { homeDir, portRange: [18750, 18759] });
  t.after(async () => manager.stop());

  await manager.setEnabled(true);
  const status = manager.getStatus();
  const metadata = JSON.parse(
    fs.readFileSync(path.join(homeDir, ".openwhispr", "mcp-server.json"), "utf8")
  );
  const { client } = await createClient(status.url, metadata.token);
  t.after(async () => client.close());

  const createResult = await client.callTool({
    name: "openwhispr_create_note",
    arguments: { title: "MCP draft", content: "Created from MCP", folder_id: 2 },
  });
  const created = JSON.parse(createResult.content[0].text);
  assert.equal(created.success, true);
  assert.equal(created.data.title, "MCP draft");

  const updateResult = await client.callTool({
    name: "openwhispr_update_note",
    arguments: { id: created.data.id, content: "Updated from MCP" },
  });
  const updated = JSON.parse(updateResult.content[0].text);
  assert.equal(updated.success, true);
  assert.equal(updated.data.content, "Updated from MCP");

  const deleteResult = await client.callTool({
    name: "openwhispr_delete_note",
    arguments: { id: created.data.id },
  });
  const deleted = JSON.parse(deleteResult.content[0].text);
  assert.deepEqual(deleted, { success: true, data: { id: created.data.id } });
});
