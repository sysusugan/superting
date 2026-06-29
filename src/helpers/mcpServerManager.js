const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
const z = require("zod/v4");
const debugLogger = require("./debugLogger");
const { ensureMigratedPath } = require("./brandConfig");
const { isPortAvailable } = require("../utils/serverUtils");
const { version: APP_VERSION } = require("../../package.json");

const HOST = "127.0.0.1";
const DEFAULT_PORT_RANGE = [8220, 8239];
const METADATA_FILE_VERSION = 1;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;
const MCP_TOOL_NAMES = [
  "health",
  "list_notes",
  "search_notes",
  "get_note",
  "create_note",
  "update_note",
  "delete_note",
  "list_folders",
  "create_folder",
  "list_transcriptions",
  "get_transcription",
  "get_dictionary",
  "get_dictionary_aliases",
  "list_tags",
];

function getMcpMetadataFilePath(homeDir = os.homedir()) {
  return path.join(ensureMigratedPath(homeDir, "config"), "mcp-server.json");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...JSON_HEADERS,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendMcpToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function sanitizeNote(note, { full = false } = {}) {
  if (!note) return null;
  const content = note.enhanced_content || note.content || "";
  return {
    id: note.id,
    title: note.title,
    content: full ? content : content.slice(0, 500),
    raw_content: full ? note.content || "" : undefined,
    enhanced_content: full ? note.enhanced_content || "" : undefined,
    transcript: full ? note.transcript || null : undefined,
    note_type: note.note_type,
    folder_id: note.folder_id ?? null,
    tags: Array.isArray(note.tags) ? note.tags : [],
    created_at: note.created_at,
    updated_at: note.updated_at,
    recorded_at: note.recorded_at ?? null,
    has_audio: Boolean(note.source_file || note.audio_duration_seconds),
    audio_duration_seconds: note.audio_duration_seconds ?? null,
  };
}

function sanitizeTranscription(transcription) {
  if (!transcription) return null;
  return {
    id: transcription.id,
    text: transcription.text,
    raw_text: transcription.raw_text ?? null,
    status: transcription.status ?? "completed",
    timestamp: transcription.timestamp ?? transcription.created_at ?? null,
    provider: transcription.provider ?? null,
    model: transcription.model ?? null,
    language: transcription.language ?? null,
    has_audio: Boolean(transcription.has_audio),
    audio_duration_ms: transcription.audio_duration_ms ?? null,
    warning: transcription.warning ?? null,
  };
}

class McpServerManager {
  constructor(ipcHandlers, options = {}) {
    this.ipcHandlers = ipcHandlers;
    this.homeDir = options.homeDir || os.homedir();
    this.portRange = options.portRange || DEFAULT_PORT_RANGE;
    this.metadataFilePath = options.metadataFilePath || getMcpMetadataFilePath(this.homeDir);
    this.server = null;
    this.port = null;
    this.token = null;
    this.enabled = false;
    this.url = null;
    this.transports = new Map();

    this._loadMetadata();
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: !!this.server,
      url: this.url,
      port: this.port,
      hasToken: !!this.token,
      tools: MCP_TOOL_NAMES.map((name) => ({ name })),
    };
  }

  getConnectionInfo() {
    const status = this.getStatus();
    return {
      ...status,
      token: this.token,
      metadataPath: this.metadataFilePath,
    };
  }

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) {
      await this.start();
    } else {
      await this.stop();
      this._writeMetadata();
    }
    return this.getStatus();
  }

  async rotateToken() {
    this.token = crypto.randomBytes(32).toString("hex");
    if (this.enabled && !this.server) await this.start();
    this._writeMetadata();
    return this.getConnectionInfo();
  }

  async start() {
    if (this.server) return;
    if (!this.enabled) return;

    if (!this.token) this.token = crypto.randomBytes(32).toString("hex");
    this.port = await this._findAvailablePort();
    this.url = `http://${HOST}:${this.port}/mcp`;

    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res).catch((error) => {
        debugLogger.error("MCP server request failed", { error: error.message }, "mcp");
        if (!res.headersSent) {
          sendJson(res, 500, {
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      });
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server = null;
        reject(error);
      };
      this.server.once("error", onError);
      this.server.listen(this.port, HOST, () => {
        this.server.removeListener("error", onError);
        resolve();
      });
    });

    this._writeMetadata();
    debugLogger.info("MCP server started", { port: this.port }, "mcp");
  }

  async stop() {
    if (!this.server) {
      this.port = null;
      this.url = null;
      return;
    }
    for (const { transport, mcpServer } of this.transports.values()) {
      await transport.close().catch(() => {});
      await mcpServer.close().catch(() => {});
    }
    this.transports.clear();
    await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
    this.port = null;
    this.url = null;
    debugLogger.info("MCP server stopped", {}, "mcp");
  }

  async _handleRequest(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
      });
      res.end();
      return;
    }

    if (new URL(req.url || "/", `http://${HOST}:${this.port}`).pathname !== "/mcp") {
      sendJson(res, 404, { error: { code: "not_found", message: "Not found" } });
      return;
    }

    if (!this._isAuthorized(req)) {
      sendJson(res, 401, { error: { code: "unauthorized", message: "Unauthorized" } });
      return;
    }

    if (req.method === "POST") {
      await this._handleMcpPost(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      const session = sessionId ? this.transports.get(sessionId) : null;
      if (!session) {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    sendJson(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
  }

  async _handleMcpPost(req, res) {
    let parsedBody;
    try {
      parsedBody = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: error.message },
        id: null,
      });
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    const existing = sessionId ? this.transports.get(sessionId) : null;
    if (existing) {
      await existing.transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (sessionId || !isInitializeRequest(parsedBody)) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }

    const mcpServer = this._createMcpServer();
    let transport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId) => {
        this.transports.set(newSessionId, { transport, mcpServer });
      },
    });
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) this.transports.delete(closedSessionId);
    };
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  }

  _isAuthorized(req) {
    const remote = req.socket?.remoteAddress;
    if (!remote || !LOOPBACK_ADDRESSES.has(remote)) return false;
    const auth = req.headers.authorization || "";
    const expected = `Bearer ${this.token}`;
    if (auth.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  }

  _createMcpServer() {
    const server = new McpServer(
      {
        name: "superting-local",
        version: APP_VERSION,
      },
      {
        instructions:
          "Use SuperTing tools for the user's local notes, folders, dictionary, and transcription text. Data is local to this desktop app. Do not request or expose raw audio; only audio metadata is available.",
      }
    );

    this._registerTools(server);
    return server;
  }

  _registerTools(server) {
    const db = this.ipcHandlers.databaseManager;

    const registerTool = (name, config, handler) => server.registerTool(name, config, handler);

    registerTool(
      "health",
      {
        title: "SuperTing health",
        description: "Check whether the local SuperTing MCP server is available.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => sendMcpToolResult({ success: true, data: { ok: true, version: 1 } })
    );

    registerTool(
      "list_notes",
      {
        title: "List SuperTing notes",
        description: "List local SuperTing notes with text previews and audio metadata.",
        inputSchema: {
          limit: z.number().optional().describe("Maximum number of notes to return. Default 100."),
          folder_id: z.number().optional().describe("Optional folder ID filter."),
          note_type: z.string().optional().describe("Optional note type filter."),
          tags: z.array(z.string()).optional().describe("Require all of these note tags."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ limit, folder_id, note_type, tags }) => {
        const notes = db
          .getNotes(
            note_type || null,
            parsePositiveInteger(limit, 100),
            folder_id || null,
            "updatedAt",
            tags || []
          )
          .map((note) => sanitizeNote(note));
        return sendMcpToolResult({ success: true, data: notes });
      }
    );

    registerTool(
      "search_notes",
      {
        title: "Search SuperTing notes",
        description: "Search local SuperTing notes by keyword and return previews.",
        inputSchema: {
          query: z.string().describe("Search query."),
          limit: z.number().optional().describe("Maximum number of results. Default 20."),
          tags: z.array(z.string()).optional().describe("Require all of these note tags."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ query, limit, tags }) => {
        const notes = db
          .searchNotes(query, parsePositiveInteger(limit, 20), tags || [])
          .map((note) => sanitizeNote(note));
        return sendMcpToolResult({ success: true, data: notes });
      }
    );

    registerTool(
      "get_note",
      {
        title: "Get SuperTing note",
        description: "Get the full text fields for a local SuperTing note.",
        inputSchema: {
          id: z.number().describe("Note ID."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => {
        const note = db.getNote(id);
        if (!note || note.deleted_at) {
          return sendMcpToolResult({ success: false, error: `Note ${id} not found`, data: null });
        }
        return sendMcpToolResult({ success: true, data: sanitizeNote(note, { full: true }) });
      }
    );

    registerTool(
      "create_note",
      {
        title: "Create SuperTing note",
        description: "Create a local SuperTing note.",
        inputSchema: {
          title: z.string().describe("Note title."),
          content: z.string().describe("Note content."),
          note_type: z.string().optional().describe("Note type. Default personal."),
          folder_id: z.number().optional().describe("Optional folder ID."),
          tags: z.array(z.string()).optional().describe("Optional note tags."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ title, content, note_type, folder_id, tags }) => {
        const result = db.saveNote(
          title,
          content,
          note_type || "personal",
          null,
          null,
          folder_id ?? null,
          null,
          tags || []
        );
        if (!result?.success || !result.note) {
          return sendMcpToolResult({
            success: false,
            error: result?.error || "Failed to create note",
          });
        }
        setImmediate(() => this.ipcHandlers.broadcastToWindows("note-added", result.note));
        this.ipcHandlers._asyncVectorUpsert(result.note);
        this.ipcHandlers._asyncMirrorWrite(result.note);
        return sendMcpToolResult({
          success: true,
          data: sanitizeNote(result.note, { full: true }),
        });
      }
    );

    registerTool(
      "update_note",
      {
        title: "Update SuperTing note",
        description: "Update title, content, enhanced content, transcript, or folder for a note.",
        inputSchema: {
          id: z.number().describe("Note ID."),
          title: z.string().optional().describe("New title."),
          content: z.string().optional().describe("New note content."),
          enhanced_content: z.string().optional().describe("New enhanced content."),
          transcript: z
            .string()
            .optional()
            .describe("New transcript text or serialized transcript JSON."),
          folder_id: z.number().nullable().optional().describe("New folder ID."),
          tags: z
            .array(z.string())
            .optional()
            .describe("Replacement note tags. Empty clears tags."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ id, title, content, enhanced_content, transcript, folder_id, tags }) => {
        const updates = {};
        if (title !== undefined) updates.title = title;
        if (content !== undefined) updates.content = content;
        if (enhanced_content !== undefined) updates.enhanced_content = enhanced_content;
        if (transcript !== undefined) updates.transcript = transcript;
        if (folder_id !== undefined) updates.folder_id = folder_id;
        if (tags !== undefined) updates.tags = tags;
        if (Object.keys(updates).length === 0) {
          return sendMcpToolResult({ success: false, error: "No note updates provided" });
        }
        const result = db.updateNote(id, updates);
        if (!result?.success || !result.note) {
          return sendMcpToolResult({
            success: false,
            error: result?.error || `Note ${id} not found`,
          });
        }
        setImmediate(() => this.ipcHandlers.broadcastToWindows("note-updated", result.note));
        this.ipcHandlers._asyncVectorUpsert(result.note);
        this.ipcHandlers._asyncMirrorWrite(result.note);
        return sendMcpToolResult({
          success: true,
          data: sanitizeNote(result.note, { full: true }),
        });
      }
    );

    registerTool(
      "delete_note",
      {
        title: "Delete SuperTing note",
        description: "Delete a local SuperTing note and its retained audio references.",
        inputSchema: {
          id: z.number().describe("Note ID."),
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ id }) => {
        const result = this.ipcHandlers.deleteNoteInternal(id);
        if (!result?.success) {
          return sendMcpToolResult({
            success: false,
            error: result?.error || `Note ${id} not found`,
          });
        }
        return sendMcpToolResult({ success: true, data: { id } });
      }
    );

    registerTool(
      "list_folders",
      {
        title: "List SuperTing folders",
        description: "List local SuperTing folders.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => sendMcpToolResult({ success: true, data: db.getFolders() })
    );

    registerTool(
      "create_folder",
      {
        title: "Create SuperTing folder",
        description: "Create a local SuperTing folder.",
        inputSchema: {
          name: z.string().describe("Folder name."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ name }) => {
        const result = db.createFolder(name);
        if (!result?.success || !result.folder) {
          return sendMcpToolResult({
            success: false,
            error: result?.error || "Failed to create folder",
          });
        }
        setImmediate(() => this.ipcHandlers.broadcastToWindows("folder-created", result.folder));
        return sendMcpToolResult({ success: true, data: result.folder });
      }
    );

    registerTool(
      "list_transcriptions",
      {
        title: "List SuperTing transcriptions",
        description: "List local transcription text records with audio metadata only.",
        inputSchema: {
          limit: z.number().optional().describe("Maximum number of transcriptions. Default 50."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ limit }) => {
        const transcriptions = db
          .getTranscriptions(parsePositiveInteger(limit, 50))
          .filter((item) => !item.deleted_at)
          .map(sanitizeTranscription);
        return sendMcpToolResult({ success: true, data: transcriptions });
      }
    );

    registerTool(
      "get_transcription",
      {
        title: "Get SuperTing transcription",
        description: "Get a local transcription text record with audio metadata only.",
        inputSchema: {
          id: z.number().describe("Transcription ID."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => {
        const transcription = db.getTranscriptionById(id);
        if (!transcription || transcription.deleted_at) {
          return sendMcpToolResult({
            success: false,
            error: `Transcription ${id} not found`,
            data: null,
          });
        }
        return sendMcpToolResult({ success: true, data: sanitizeTranscription(transcription) });
      }
    );

    registerTool(
      "get_dictionary",
      {
        title: "Get SuperTing dictionary",
        description: "Get custom dictionary words used by local transcription correction.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => sendMcpToolResult({ success: true, data: db.getDictionary() })
    );

    registerTool(
      "get_dictionary_aliases",
      {
        title: "Get SuperTing dictionary aliases",
        description:
          "Get custom dictionary alias replacements used by local transcription correction.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => sendMcpToolResult({ success: true, data: db.getDictionaryAliases() })
    );

    registerTool(
      "list_tags",
      {
        title: "List SuperTing note tags",
        description: "List tags used by local SuperTing notes.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => sendMcpToolResult({ success: true, data: db.getTags() })
    );
  }

  async _findAvailablePort() {
    const [start, end] = this.portRange;
    for (let port = start; port <= end; port++) {
      if (await isPortAvailable(port)) return port;
    }
    throw new Error(`No available ports in range ${start}-${end}`);
  }

  _loadMetadata() {
    try {
      const metadata = JSON.parse(fs.readFileSync(this.metadataFilePath, "utf8"));
      this.enabled = !!metadata.enabled;
      this.token = typeof metadata.token === "string" ? metadata.token : null;
    } catch (error) {
      if (error.code !== "ENOENT") {
        debugLogger.debug("MCP metadata read failed", { error: error.message }, "mcp");
      }
    }
  }

  _writeMetadata() {
    const dir = path.dirname(this.metadataFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const metadata = {
      version: METADATA_FILE_VERSION,
      enabled: this.enabled,
      running: !!this.server,
      url: this.url,
      port: this.port,
      token: this.token,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.metadataFilePath, JSON.stringify(metadata), { mode: 0o600 });
    try {
      fs.chmodSync(this.metadataFilePath, 0o600);
    } catch (error) {
      debugLogger.debug("MCP metadata chmod failed", { error: error.message }, "mcp");
    }
  }
}

module.exports = McpServerManager;
module.exports.getMcpMetadataFilePath = getMcpMetadataFilePath;
module.exports.MCP_TOOL_NAMES = MCP_TOOL_NAMES;
