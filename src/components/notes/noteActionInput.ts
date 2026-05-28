interface NoteActionInputOptions {
  noteContent: string;
  rawTranscript?: string | null;
  speakerLabels: {
    you: string;
    them: string;
  };
}

interface StoredTranscriptSegment {
  source?: "mic" | "system";
  text?: string;
}

function parseStoredTranscriptSegments(raw: string): StoredTranscriptSegment[] {
  if (!raw.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface NoteActionInput {
  content: string;
  isMeetingNote: boolean;
}

export function buildNoteActionInput({
  noteContent,
  rawTranscript,
  speakerLabels,
}: NoteActionInputOptions): NoteActionInput | null {
  const hasNotes = !!noteContent.trim();
  const transcript = rawTranscript?.trim() || "";
  if (!hasNotes && !transcript) return null;

  let formattedTranscript = "";
  const isMeetingNote = !!transcript;
  if (transcript) {
    const segments = parseStoredTranscriptSegments(transcript);
    if (segments.length > 0) {
      formattedTranscript = segments
        .filter((segment) => typeof segment.text === "string" && segment.text.trim())
        .map(
          (segment) =>
            `${segment.source === "mic" ? speakerLabels.you : speakerLabels.them}: ${segment.text}`
        )
        .join("\n");
    }
    if (!formattedTranscript) {
      formattedTranscript = transcript;
    }
  }

  const content = [
    hasNotes ? noteContent : "",
    formattedTranscript ? `## Meeting Transcript\n${formattedTranscript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { content, isMeetingNote };
}
