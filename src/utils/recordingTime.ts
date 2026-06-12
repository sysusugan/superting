export function getElapsedRecordingSeconds(
  recordingStartedAt: number | null | undefined,
  nowMs = Date.now()
): number {
  if (!recordingStartedAt || !Number.isFinite(recordingStartedAt)) return 0;
  return Math.max(0, Math.floor((nowMs - recordingStartedAt) / 1000));
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatRecordingElapsed(
  recordingStartedAt: number | null | undefined,
  nowMs = Date.now()
): string {
  return formatClock(getElapsedRecordingSeconds(recordingStartedAt, nowMs));
}

export function getRelativeTranscriptSeconds(
  timestamp: number | null | undefined,
  recordingStartedAt?: number | null,
  timelineDurationSeconds?: number | null
): number | undefined {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return undefined;
  if (timestamp <= 1_000_000_000) {
    const seconds = Math.max(0, timestamp);
    if (
      typeof timelineDurationSeconds === "number" &&
      Number.isFinite(timelineDurationSeconds) &&
      timelineDurationSeconds > 0 &&
      seconds > timelineDurationSeconds + 30
    ) {
      const centiseconds = seconds / 100;
      if (centiseconds <= timelineDurationSeconds + 30) return Math.max(0, centiseconds);
    }
    return seconds;
  }
  if (!recordingStartedAt || !Number.isFinite(recordingStartedAt)) return undefined;
  return Math.max(0, (timestamp - recordingStartedAt) / 1000);
}

export function formatTranscriptTimestamp(
  timestamp: number | null | undefined,
  recordingStartedAt?: number | null,
  timelineDurationSeconds?: number | null
): string {
  const seconds = getRelativeTranscriptSeconds(
    timestamp,
    recordingStartedAt,
    timelineDurationSeconds
  );
  return seconds == null ? "" : formatClock(seconds);
}

export function getTranscriptSeekSeconds(
  timestamp: number | null | undefined,
  recordingStartedAt?: number | null,
  timelineDurationSeconds?: number | null
): number | undefined {
  return getRelativeTranscriptSeconds(timestamp, recordingStartedAt, timelineDurationSeconds);
}

export interface PlaybackTranscriptSegment {
  id: string;
  timestamp?: number | null;
}

export function getPlaybackActiveSegmentId(
  currentSeconds: number,
  segments: PlaybackTranscriptSegment[],
  recordingStartedAt?: number | null,
  timelineDurationSeconds?: number | null
): string | null {
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return null;

  const timeline = segments
    .map((segment) => ({
      id: segment.id,
      seconds: getRelativeTranscriptSeconds(
        segment.timestamp,
        recordingStartedAt,
        timelineDurationSeconds
      ),
    }))
    .filter((item): item is { id: string; seconds: number } => item.seconds != null)
    .sort((a, b) => a.seconds - b.seconds);

  if (timeline.length === 0 || currentSeconds < timeline[0].seconds) return null;

  let activeId = timeline[0].id;
  for (const item of timeline) {
    if (item.seconds > currentSeconds) break;
    activeId = item.id;
  }
  return activeId;
}
