const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const AUDIO_MIME_BY_EXTENSION = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return Array.isArray(value) ? value[0] : value;
  }
  return null;
}

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = String(rangeHeader).trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { invalid: true };

  let start;
  let end;
  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }

  return { start, end: Math.min(end, size - 1) };
}

function createNoteAudioFileResponse(filePath, headers) {
  const stats = fs.statSync(filePath);
  const size = stats.size;
  const contentType =
    AUDIO_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  };
  const range = parseByteRange(getHeader(headers, "range"), size);

  if (range?.invalid || (range && size === 0)) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(size),
      },
    });
  }

  const { start, end } = range;
  return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}

module.exports = {
  createNoteAudioFileResponse,
  parseByteRange,
};
