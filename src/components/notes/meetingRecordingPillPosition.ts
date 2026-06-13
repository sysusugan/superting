export interface MeetingRecordingPillPosition {
  x: number;
  y: number;
}

export interface MeetingRecordingPillBounds {
  viewportWidth: number;
  viewportHeight: number;
  pillWidth: number;
  pillHeight: number;
}

export const MEETING_RECORDING_PILL_POSITION_KEY = "meetingRecordingPillPosition";

const EDGE_GAP = 8;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function getDefaultMeetingRecordingPillPosition(
  bounds: MeetingRecordingPillBounds
): MeetingRecordingPillPosition {
  return clampMeetingRecordingPillPosition(
    {
      x: (bounds.viewportWidth - bounds.pillWidth) / 2,
      y: EDGE_GAP,
    },
    bounds
  );
}

export function clampMeetingRecordingPillPosition(
  position: MeetingRecordingPillPosition,
  bounds: MeetingRecordingPillBounds
): MeetingRecordingPillPosition {
  const maxX = Math.max(EDGE_GAP, bounds.viewportWidth - bounds.pillWidth - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, bounds.viewportHeight - bounds.pillHeight - EDGE_GAP);

  return {
    x: Math.round(Math.min(Math.max(position.x, EDGE_GAP), maxX)),
    y: Math.round(Math.min(Math.max(position.y, EDGE_GAP), maxY)),
  };
}

export function parseMeetingRecordingPillPosition(
  value: string | null
): MeetingRecordingPillPosition | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !isFiniteNumber((parsed as { x?: unknown }).x) ||
      !isFiniteNumber((parsed as { y?: unknown }).y)
    ) {
      return null;
    }

    return {
      x: (parsed as { x: number }).x,
      y: (parsed as { y: number }).y,
    };
  } catch {
    return null;
  }
}
