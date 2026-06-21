import type { TranscriptSegment } from "../stores/meetingRecordingStore";

export interface ImportedTranscriptTxt {
  title: string | null;
  segments: TranscriptSegment[];
}

function parseTimestampSeconds(value: string): number | null {
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
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

export function parseImportedTranscriptTxt(raw: string): ImportedTranscriptTxt {
  const lines = String(raw || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const title = lines.find((line) => line.trim())?.trim() || null;
  const headerPattern = /^(.+?)\s+(\d{1,2}:\d{2}:\d{2})(.*)$/;
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
    const match = line.match(headerPattern);
    const seconds = match ? parseTimestampSeconds(match[2]) : null;
    if (match && seconds !== null) {
      flush();
      current = {
        label: match[1].trim(),
        timestamp: seconds,
        textLines: match[3].trim() ? [match[3].trim()] : [],
      };
      continue;
    }
    if (!current) continue;
    current.textLines.push(line);
  }
  flush();

  return { title, segments };
}
