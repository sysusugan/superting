import type { TranscriptSegment } from "../stores/meetingRecordingStore";

export interface ImportedTranscriptTxt {
  title: string | null;
  segments: TranscriptSegment[];
}

function parseTimestampSeconds(value: string): number | null {
  const parts = value.split(":").map((part) => Number(part));
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isFinite(part) || part < 0)
  ) {
    return null;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function hashSpeakerName(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function buildSpeakerPatch(label: string): Partial<TranscriptSegment> {
  const generic = label.match(/^(?:发言(?:人|者)|说话人)\s*(\d+)$/);
  if (generic) {
    const n = Math.max(1, Number(generic[1]) || 1);
    return {
      speaker: `speaker_${n - 1}`,
      speakerIsPlaceholder: true,
      speakerStatus: "confirmed",
    };
  }

  return {
    speaker: `manual_${hashSpeakerName(label)}`,
    speakerName: label,
    speakerIsPlaceholder: false,
    speakerLocked: true,
    speakerStatus: "locked",
    speakerLockSource: "user",
  };
}

function parseHeaderLine(line: string): {
  label: string;
  timestamp: number;
  inlineText: string;
} | null {
  const timestampPattern = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
  const bracketedMatch = line.match(
    new RegExp(`^(.+?)\\s*\\(\\s*(${timestampPattern})\\s*\\)\\s*[:：]?\\s*(.*)$`)
  );
  const legacyMatch = line.match(new RegExp(`^(.+?)\\s+(${timestampPattern})(?!\\|)(.*)$`));
  const match = bracketedMatch || legacyMatch;
  const seconds = match ? parseTimestampSeconds(match[2]) : null;
  if (!match || seconds === null) return null;

  return {
    label: match[1].trim(),
    timestamp: seconds,
    inlineText: match[3].trim(),
  };
}

function parseSplitHeader(
  lines: string[],
  index: number
): { label: string; timestamp: number; inlineText: string } | null {
  const label = lines[index]?.trim();
  const timestampLine = lines[index + 1]?.trim();
  if (!label || !/^\d{1,2}:\d{2}:\d{2}$/.test(timestampLine || "")) return null;

  const timestamp = parseTimestampSeconds(timestampLine);
  return timestamp === null ? null : { label, timestamp, inlineText: "" };
}

export function parseImportedTranscriptTxt(raw: string): ImportedTranscriptTxt {
  const lines = String(raw || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const firstHeaderIndex = lines.findIndex(
    (line, index) => parseHeaderLine(line) || parseSplitHeader(lines, index)
  );
  const splitTimelineStart =
    firstHeaderIndex >= 0 && !parseHeaderLine(lines[firstHeaderIndex])
      ? (parseSplitHeader(lines, firstHeaderIndex)?.timestamp ?? null)
      : null;
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim());
  const title =
    firstNonEmptyIndex >= 0 && (firstHeaderIndex < 0 || firstNonEmptyIndex < firstHeaderIndex)
      ? lines[firstNonEmptyIndex].trim()
      : null;
  const segments: TranscriptSegment[] = [];
  let current: {
    label: string;
    timestamp: number;
    textLines: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.textLines.join("\n").trim();
    if (!text) {
      current = null;
      return;
    }
    segments.push({
      id: `imported-${segments.length}`,
      text,
      source: "system",
      timestamp: current.timestamp,
      ...buildSpeakerPatch(current.label),
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inlineHeader = parseHeaderLine(line);
    const splitHeader = splitTimelineStart === null ? null : parseSplitHeader(lines, i);
    const header = inlineHeader || splitHeader;
    if (header) {
      flush();
      current = {
        label: header.label,
        timestamp:
          splitTimelineStart === null
            ? header.timestamp
            : Math.max(0, header.timestamp - splitTimelineStart),
        textLines: header.inlineText ? [header.inlineText] : [],
      };
      if (splitHeader) i += 1;
      continue;
    }
    if (!current) continue;
    current.textLines.push(line);
  }
  flush();

  return { title, segments };
}
