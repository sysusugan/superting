const fs = require("fs");
const path = require("path");

const FIELD_LABELS = {
  transcript: "Transcription",
  content: "Notes",
  enhanced_content: "Enhanced Content",
};

const VALID_FIELDS = new Set(Object.keys(FIELD_LABELS));
const VALID_FORMATS = new Set(["md", "txt"]);

function stripMarkdown(text) {
  return String(text || "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^>\s+/gm, "")
    .trim();
}

function parseTranscript(transcript) {
  if (!transcript) return [];
  try {
    const parsed = JSON.parse(transcript);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

function formatTimestamp(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function resolveSpeaker(segment) {
  if (segment.speakerName && !segment.speakerIsPlaceholder) return segment.speakerName;
  if (segment.speaker === "you") return "You";
  if (segment.speaker) {
    const number = Number.parseInt(String(segment.speaker).replace("speaker_", ""), 10);
    return Number.isNaN(number) ? String(segment.speaker) : `Speaker ${number + 1}`;
  }
  if (segment.source === "mic") return "You";
  if (segment.source === "system") return "Others";
  return "";
}

function formatTranscriptSegment(segment, format) {
  const text = String(segment.text || "").trim();
  if (!text) return "";

  const speaker = resolveSpeaker(segment);
  const timestamp = formatTimestamp(segment.timestamp);
  const prefixParts = [];
  if (speaker) prefixParts.push(speaker);
  if (timestamp) prefixParts.push(format === "md" ? `\`${timestamp}\`` : `[${timestamp}]`);
  const prefix = prefixParts.length ? `${prefixParts.join(" ")}: ` : "";

  return `${prefix}${text}`;
}

function formatTranscript(note, format) {
  const segments = parseTranscript(note.transcript);
  if (segments === null) return "";
  if (segments.length > 0) {
    return segments
      .map((segment) => formatTranscriptSegment(segment, format))
      .filter(Boolean)
      .join("\n\n");
  }
  return String(note.transcript || "").trim();
}

function getFieldValue(note, field, format) {
  if (field === "transcript") return formatTranscript(note, format);
  if (field === "content")
    return format === "txt" ? stripMarkdown(note.content) : String(note.content || "");
  if (field === "enhanced_content") {
    return format === "txt"
      ? stripMarkdown(note.enhanced_content)
      : String(note.enhanced_content || "");
  }
  return "";
}

function normalizeExportOptions(options = {}) {
  const format = VALID_FORMATS.has(options.format) ? options.format : "md";
  const fields = Array.isArray(options.fields)
    ? options.fields.filter((field) => VALID_FIELDS.has(field))
    : [];
  return { format, fields };
}

function formatExportDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSelectedNoteExport(note, options) {
  const { format, fields } = normalizeExportOptions(options);
  const title = note.title || "Untitled";
  const created = formatExportDate(note.created_at);

  if (format === "txt") {
    const lines = [title];
    if (created) lines.push(`Created: ${created}`);
    lines.push("");
    for (const field of fields) {
      const value = getFieldValue(note, field, format);
      lines.push(FIELD_LABELS[field].toUpperCase());
      if (value) lines.push(value);
      lines.push("");
    }
    return lines.join("\n").trimEnd() + "\n";
  }

  const lines = [`# ${title}`, ""];
  if (created) lines.push(`**Created:** ${created}`, "");
  for (const field of fields) {
    const value = getFieldValue(note, field, format);
    lines.push(`## ${FIELD_LABELS[field]}`, "");
    if (value) lines.push(value, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function safeExportBaseName(note) {
  const title = String(note.title || "Untitled")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${title || "Untitled"}-${note.id}`;
}

function uniqueExportPath(directory, baseName, extension) {
  let candidate = path.join(directory, `${baseName}.${extension}`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName}-${suffix}.${extension}`);
    suffix += 1;
  }
  return candidate;
}

module.exports = {
  buildSelectedNoteExport,
  normalizeExportOptions,
  safeExportBaseName,
  stripMarkdown,
  uniqueExportPath,
};
