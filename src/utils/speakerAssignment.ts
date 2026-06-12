interface AssignableTranscriptSegment {
  id: string;
  text: string;
  source: "mic" | "system";
  timestamp?: number;
  speaker?: string;
  speakerName?: string;
  speakerIsPlaceholder?: boolean;
  suggestedName?: string;
  suggestedProfileId?: number;
  speakerStatus?: "provisional" | "confirmed" | "suggested" | "locked";
  speakerLocked?: boolean;
  speakerLockSource?: "user" | "diarization" | "suggestion";
}

interface SpeakerDisplayLabels {
  you: string;
  speaker: (n: number) => string;
}

interface SpeakerDisplayOptions {
  selfFallback?: boolean;
}

export interface TranscriptSpeakerFilterOption {
  key: string;
  label: string;
  colorKey: string;
}

export interface TranscriptSpeakerBlock<T extends AssignableTranscriptSegment> {
  id: string;
  text: string;
  source: T["source"];
  timestamp?: number;
  speaker?: string;
  speakerName?: string;
  speakerDisplay: ReturnType<typeof getTranscriptSpeakerDisplay<T>>;
  segments: T[];
}

interface TranscriptSpeakerBlockOptions {
  maxBlockDurationSeconds?: number;
  maxBlockTextLength?: number;
  selfFallback?: boolean;
  timelineDurationSeconds?: number | null;
}

const getSpeakerNumber = (speakerId: string) => {
  const match = speakerId.match(/speaker_(\d+)/);
  return match ? Number(match[1]) + 1 : 1;
};

const getTranscriptSpeakerFilterKey = (segment: AssignableTranscriptSegment) =>
  segment.speaker ? `speaker:${segment.speaker}` : `source:${segment.source}`;

const getTranscriptSpeakerBlockKey = (
  segment: AssignableTranscriptSegment,
  speakerMappings: Record<string, string> = {}
) => {
  const mapped = segment.speaker ? speakerMappings[segment.speaker] : undefined;
  if (segment.speakerName) return `name:${segment.speakerName.toLowerCase()}`;
  if (mapped) return `name:${mapped.toLowerCase()}`;
  if (segment.speaker) return `speaker:${segment.speaker}`;
  return `source:${segment.source}`;
};

const normalizeTranscriptTimestampSeconds = (
  timestamp: number,
  timelineDurationSeconds?: number | null
) => {
  if (timestamp > 1_000_000_000) return timestamp / 1000;
  if (
    typeof timelineDurationSeconds === "number" &&
    Number.isFinite(timelineDurationSeconds) &&
    timelineDurationSeconds > 0 &&
    timestamp > timelineDurationSeconds + 30 &&
    timestamp / 100 <= timelineDurationSeconds + 30
  ) {
    return timestamp / 100;
  }
  return timestamp;
};

const getTranscriptTimestampDeltaSeconds = (
  from: number,
  to: number,
  timelineDurationSeconds?: number | null
) => {
  const normalizedFrom = normalizeTranscriptTimestampSeconds(from, timelineDurationSeconds);
  const normalizedTo = normalizeTranscriptTimestampSeconds(to, timelineDurationSeconds);
  return normalizedTo - normalizedFrom;
};

const offsetTranscriptTimestamp = (
  timestamp: number | undefined,
  offsetSeconds: number,
  timelineDurationSeconds?: number | null
) => {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return timestamp;
  if (timestamp > 1_000_000_000) return timestamp + offsetSeconds * 1000;
  if (
    typeof timelineDurationSeconds === "number" &&
    Number.isFinite(timelineDurationSeconds) &&
    timelineDurationSeconds > 0 &&
    timestamp > timelineDurationSeconds + 30 &&
    timestamp / 100 <= timelineDurationSeconds + 30
  ) {
    return timestamp + offsetSeconds * 100;
  }
  return timestamp + offsetSeconds;
};

const splitTextForDisplay = (text: string, maxLength: number | null) => {
  const normalized = text.trim();
  if (!maxLength || normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    const windowText = remaining.slice(0, maxLength + 1);
    const breakIndex = Math.max(
      windowText.lastIndexOf("。"),
      windowText.lastIndexOf("！"),
      windowText.lastIndexOf("？"),
      windowText.lastIndexOf("."),
      windowText.lastIndexOf("!"),
      windowText.lastIndexOf("?"),
      windowText.lastIndexOf("，"),
      windowText.lastIndexOf(","),
      windowText.lastIndexOf(" ")
    );
    const cut = breakIndex > Math.floor(maxLength * 0.45) ? breakIndex + 1 : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
};

const isUnresolvedProvisionalPlaceholder = (segment: AssignableTranscriptSegment) =>
  segment.speakerIsPlaceholder === true &&
  segment.speakerStatus === "provisional" &&
  !segment.speakerName &&
  !segment.speakerLocked;

const stableManualSpeakerId = (segment: AssignableTranscriptSegment) =>
  `manual_${segment.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const lockSpeakerName = <T extends AssignableTranscriptSegment>(
  segment: T,
  displayName: string
): T => ({
  ...segment,
  speaker:
    !segment.speaker || segment.speaker === "you"
      ? stableManualSpeakerId(segment)
      : segment.speaker,
  speakerName: displayName,
  speakerIsPlaceholder: false,
  suggestedName: undefined,
  suggestedProfileId: undefined,
  speakerLocked: true,
  speakerStatus: "locked",
  speakerLockSource: "user",
});

export function getTranscriptSpeakerDisplay<T extends AssignableTranscriptSegment>(
  segment: T,
  speakerMappings: Record<string, string> = {},
  labels: SpeakerDisplayLabels,
  options: SpeakerDisplayOptions = {}
) {
  const mapped = segment.speaker ? speakerMappings[segment.speaker] : undefined;
  const useSelfFallback = options.selfFallback !== false;
  const label =
    segment.speakerName ||
    mapped ||
    (useSelfFallback && segment.speaker === "you"
      ? labels.you
      : segment.speaker
        ? labels.speaker(getSpeakerNumber(segment.speaker))
        : useSelfFallback && segment.source === "mic"
          ? labels.you
          : labels.speaker(1));

  return {
    label,
    isSelf:
      useSelfFallback &&
      !segment.speakerName &&
      !mapped &&
      (segment.speaker === "you" || segment.source === "mic"),
  };
}

export function assignSpeakerGroupName<T extends AssignableTranscriptSegment>(
  segments: T[],
  speakerId: string,
  displayName: string
): T[] {
  return segments.map((segment) =>
    segment.speaker === speakerId ? lockSpeakerName(segment, displayName) : segment
  );
}

export function getTranscriptSpeakerFilterOptions<T extends AssignableTranscriptSegment>(
  segments: T[],
  speakerMappings: Record<string, string> = {},
  labels: SpeakerDisplayLabels
): TranscriptSpeakerFilterOption[] {
  const byKey = new Map<string, TranscriptSpeakerFilterOption>();

  for (const segment of segments) {
    if (isUnresolvedProvisionalPlaceholder(segment)) {
      continue;
    }

    const key = getTranscriptSpeakerFilterKey(segment);
    const display = getTranscriptSpeakerDisplay(segment, speakerMappings, labels);
    const option = {
      key,
      label: display.label,
      colorKey: segment.speaker || segment.source,
    };

    if (!byKey.has(key)) {
      byKey.set(key, option);
      continue;
    }

    if (segment.speakerName || (segment.speaker && speakerMappings[segment.speaker])) {
      byKey.set(key, option);
    }
  }

  return [...byKey.values()];
}

export function filterTranscriptSegmentsBySpeaker<T extends AssignableTranscriptSegment>(
  segments: T[],
  selectedSpeakerKeys: Set<string> | null
): T[] {
  if (!selectedSpeakerKeys) return segments;
  return segments.filter((segment) =>
    selectedSpeakerKeys.has(getTranscriptSpeakerFilterKey(segment))
  );
}

export function buildTranscriptSpeakerBlocks<T extends AssignableTranscriptSegment>(
  segments: T[],
  speakerMappings: Record<string, string> = {},
  labels: SpeakerDisplayLabels,
  options: TranscriptSpeakerBlockOptions = {}
): TranscriptSpeakerBlock<T>[] {
  const blocks: TranscriptSpeakerBlock<T>[] = [];
  const maxBlockDurationSeconds =
    typeof options.maxBlockDurationSeconds === "number" &&
    Number.isFinite(options.maxBlockDurationSeconds) &&
    options.maxBlockDurationSeconds > 0
      ? options.maxBlockDurationSeconds
      : null;
  const maxBlockTextLength =
    typeof options.maxBlockTextLength === "number" &&
    Number.isFinite(options.maxBlockTextLength) &&
    options.maxBlockTextLength > 0
      ? Math.floor(options.maxBlockTextLength)
      : null;
  const displayOptions = { selfFallback: options.selfFallback };
  const timelineDurationSeconds = options.timelineDurationSeconds;

  const canMergeIntoPreviousBlock = (
    previous: TranscriptSpeakerBlock<T> | undefined,
    segment: T,
    key: string
  ) => {
    if (!previous) return false;
    if (getTranscriptSpeakerBlockKey(previous.segments[0], speakerMappings) !== key) return false;
    if (
      maxBlockTextLength != null &&
      `${previous.text} ${segment.text.trim()}`.trim().length > maxBlockTextLength
    ) {
      return false;
    }
    if (maxBlockDurationSeconds == null) return true;
    if (
      typeof previous.timestamp !== "number" ||
      !Number.isFinite(previous.timestamp) ||
      typeof segment.timestamp !== "number" ||
      !Number.isFinite(segment.timestamp)
    ) {
      return true;
    }
    return (
      getTranscriptTimestampDeltaSeconds(
        previous.timestamp,
        segment.timestamp,
        timelineDurationSeconds
      ) <=
      maxBlockDurationSeconds
    );
  };

  for (const segment of segments) {
    const key = getTranscriptSpeakerBlockKey(segment, speakerMappings);
    const previous = blocks[blocks.length - 1];

    if (canMergeIntoPreviousBlock(previous, segment, key)) {
      previous.segments.push(segment);
      previous.text = previous.segments
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(" ");
      continue;
    }

    const chunks = splitTextForDisplay(segment.text, maxBlockTextLength);
    chunks.forEach((text, chunkIndex) => {
      const chunkSegment =
        chunkIndex === 0
          ? segment
          : {
              ...segment,
              id: `${segment.id}:part-${chunkIndex + 1}`,
              text,
              timestamp:
                maxBlockDurationSeconds == null
                  ? segment.timestamp
                  : offsetTranscriptTimestamp(
                      segment.timestamp,
                      maxBlockDurationSeconds * chunkIndex,
                      timelineDurationSeconds
                    ),
            };
      blocks.push({
        id: chunkSegment.id,
        text,
        source: chunkSegment.source,
        timestamp: chunkSegment.timestamp,
        speaker: chunkSegment.speaker,
        speakerName: chunkSegment.speakerName,
        speakerDisplay: getTranscriptSpeakerDisplay(
          chunkSegment,
          speakerMappings,
          labels,
          displayOptions
        ),
        segments: [chunkSegment],
      });
    });
  }

  return blocks;
}
