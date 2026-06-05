const fs = require("fs");
const path = require("path");
const { app, net, protocol } = require("electron");
const { randomUUID } = require("crypto");
const { pathToFileURL } = require("url");
const debugLogger = require("./debugLogger");

const NOTE_ASSET_PROTOCOL = "openwhispr-note-asset";
const NOTE_ASSET_URL_PREFIX = `${NOTE_ASSET_PROTOCOL}://`;
const MAX_NOTE_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif",
};

let noteAssetProtocolRegistered = false;

function normalizeImageMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  return IMAGE_MIME_TO_EXT[normalized] ? normalized : null;
}

function getNoteAssetsRoot() {
  return path.join(app.getPath("userData"), "note-assets");
}

function buildNoteAssetUrl(assetId) {
  return `${NOTE_ASSET_URL_PREFIX}${encodeURIComponent(String(assetId))}`;
}

function isNoteAssetUrl(value) {
  return typeof value === "string" && value.startsWith(NOTE_ASSET_URL_PREFIX);
}

function getAssetIdFromUrl(value) {
  if (!isNoteAssetUrl(value)) return null;
  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

function safeOriginalName(name, ext) {
  const base = path
    .basename(String(name || "image"))
    .replace(/\.[^.]+$/, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .slice(0, 60);
  return `${base || "image"}.${ext}`;
}

function assertSafeSvg(buffer) {
  const text = buffer.toString("utf8");
  if (!/<svg[\s>]/i.test(text.slice(0, 4096))) {
    throw new Error("Invalid SVG image");
  }

  if (
    /<script\b/i.test(text) ||
    /<foreignObject\b/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /(?:href|xlink:href)\s*=\s*["']?\s*javascript:/i.test(text) ||
    /(?:href|xlink:href)\s*=\s*["']?\s*data:text\/html/i.test(text)
  ) {
    throw new Error("Unsafe SVG image");
  }
}

function createNoteImageAsset(databaseManager, noteId, payload = {}) {
  const mimeType = normalizeImageMimeType(payload.mimeType || payload.type);
  if (!mimeType) throw new Error("Unsupported image type");

  const buffer = Buffer.from(payload.data || []);
  if (!buffer.length) throw new Error("Image data is empty");
  if (buffer.length > MAX_NOTE_IMAGE_BYTES) throw new Error("Image is larger than 10MB");
  if (mimeType === "image/svg+xml") assertSafeSvg(buffer);

  const note = databaseManager.getNote(noteId);
  if (!note) throw new Error("Note not found");

  const ext = IMAGE_MIME_TO_EXT[mimeType];
  const assetId = randomUUID();
  const filename = safeOriginalName(payload.name, ext);
  const storedFilename = `${assetId}.${ext}`;
  const noteDir = path.join(getNoteAssetsRoot(), String(noteId));
  fs.mkdirSync(noteDir, { recursive: true });
  const filePath = path.join(noteDir, storedFilename);
  fs.writeFileSync(filePath, buffer);

  const entry = databaseManager.createNoteAsset({
    id: assetId,
    noteId,
    filename,
    storedFilename,
    mimeType,
    sizeBytes: buffer.length,
  });

  return {
    ...entry,
    url: buildNoteAssetUrl(assetId),
  };
}

function resolveNoteAssetPath(databaseManager, assetId) {
  if (!assetId) return null;
  const asset = databaseManager.getNoteAsset(assetId);
  if (!asset) return null;
  const root = getNoteAssetsRoot();
  const filePath = path.resolve(root, String(asset.note_id), asset.stored_filename);
  if (!filePath.startsWith(path.resolve(root) + path.sep)) return null;
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? { asset, filePath } : null;
  } catch {
    return null;
  }
}

function readNoteAssetBuffer(databaseManager, assetId) {
  const resolved = resolveNoteAssetPath(databaseManager, assetId);
  if (!resolved) return null;
  return {
    asset: resolved.asset,
    buffer: fs.readFileSync(resolved.filePath),
    filePath: resolved.filePath,
  };
}

function deleteNoteAssetFile(asset) {
  if (!asset) return;
  const filePath = path.join(getNoteAssetsRoot(), String(asset.note_id), asset.stored_filename);
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function deleteNoteAsset(databaseManager, assetId) {
  const asset = databaseManager.getNoteAsset(assetId);
  if (!asset) return { success: false };
  deleteNoteAssetFile(asset);
  databaseManager.deleteNoteAsset(assetId);
  return { success: true };
}

function cleanupNoteAssetFiles(databaseManager, noteId) {
  const assets = databaseManager.getNoteAssets(noteId);
  for (const asset of assets) deleteNoteAssetFile(asset);
  try {
    fs.rmSync(path.join(getNoteAssetsRoot(), String(noteId)), { recursive: true, force: true });
  } catch {}
}

function registerNoteAssetProtocol(databaseManager) {
  if (noteAssetProtocolRegistered) return;
  protocol.handle(NOTE_ASSET_PROTOCOL, async (request) => {
    const assetId = getAssetIdFromUrl(request.url);
    const resolved = resolveNoteAssetPath(databaseManager, assetId);
    if (!resolved) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved.filePath).toString());
  });
  noteAssetProtocolRegistered = true;
  debugLogger.info("Registered note asset protocol", { protocol: NOTE_ASSET_PROTOCOL }, "notes");
}

module.exports = {
  NOTE_ASSET_PROTOCOL,
  MAX_NOTE_IMAGE_BYTES,
  buildNoteAssetUrl,
  createNoteImageAsset,
  cleanupNoteAssetFiles,
  deleteNoteAsset,
  getAssetIdFromUrl,
  isNoteAssetUrl,
  readNoteAssetBuffer,
  registerNoteAssetProtocol,
};
