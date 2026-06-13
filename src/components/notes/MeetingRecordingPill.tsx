import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Square } from "lucide-react";
import { stopRecording, useMeetingRecordingStore } from "../../stores/meetingRecordingStore";
import { cn } from "../lib/utils";
import {
  clampMeetingRecordingPillPosition,
  getDefaultMeetingRecordingPillPosition,
  MEETING_RECORDING_PILL_POSITION_KEY,
  parseMeetingRecordingPillPosition,
  type MeetingRecordingPillPosition,
} from "./meetingRecordingPillPosition";

interface MeetingRecordingPillProps {
  activeView: string;
  activeNoteId: number | null;
  onReturnToNote: () => void;
}

const BAR_COUNT = 4;
const BAR_FLOOR = 12;
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  hasMoved: boolean;
}

const isControlPanelWindow = () => {
  if (typeof window === "undefined") return false;
  const { search, pathname } = window.location;
  return pathname.includes("control") || search.includes("panel=true");
};

const truncateTitle = (title: string) =>
  title.length > 20 ? `${title.slice(0, 19).trimEnd()}…` : title;

const computeBarHeight = (level: number, index: number) => {
  // Per-bar phase keeps the stack from moving in lockstep at sustained levels.
  // sqrt curve maps small RMS values (typical speech ~0.05-0.1) into a
  // visible range — linear scaling kept bars clamped at the floor.
  const phase = 0.7 + 0.3 * Math.sin(index * 1.7);
  const scaled = Math.sqrt(level) * 180 * phase;
  return `${Math.max(BAR_FLOOR, Math.min(100, scaled))}%`;
};

export default function MeetingRecordingPill({
  activeView,
  activeNoteId,
  onReturnToNote,
}: MeetingRecordingPillProps) {
  const { t } = useTranslation();
  const isRecording = useMeetingRecordingStore((s) => s.isRecording);
  const recordingNoteId = useMeetingRecordingStore((s) => s.recordingNoteId);
  const recordingNoteTitle = useMeetingRecordingStore((s) => s.recordingNoteTitle);
  const micLevel = useMeetingRecordingStore((s) => s.currentMicLevel);
  const [isStopping, setIsStopping] = useState(false);
  const [position, setPosition] = useState<MeetingRecordingPillPosition | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<MeetingRecordingPillPosition | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressReturnClickRef = useRef(false);

  const isViewingRecordingNote =
    activeView === "personal-notes" && activeNoteId === recordingNoteId;

  const getMeasuredBounds = useCallback(() => {
    const rect = pillRef.current?.getBoundingClientRect();
    if (!rect) return null;

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pillWidth: rect.width,
      pillHeight: rect.height,
    };
  }, []);

  const persistPosition = useCallback((nextPosition: MeetingRecordingPillPosition) => {
    try {
      window.localStorage.setItem(
        MEETING_RECORDING_PILL_POSITION_KEY,
        JSON.stringify(nextPosition)
      );
    } catch {
      // Persisting a drag position is best-effort; the pill should remain movable.
    }
  }, []);

  const setMeasuredPosition = useCallback(
    (nextPosition: MeetingRecordingPillPosition, shouldPersist = false) => {
      positionRef.current = nextPosition;
      setPosition(nextPosition);
      if (shouldPersist) persistPosition(nextPosition);
    },
    [persistPosition]
  );

  const resolveInitialPosition = useCallback(() => {
    const bounds = getMeasuredBounds();
    if (!bounds) return;

    const storedPosition = parseMeetingRecordingPillPosition(
      window.localStorage.getItem(MEETING_RECORDING_PILL_POSITION_KEY)
    );
    const nextPosition = storedPosition
      ? clampMeetingRecordingPillPosition(storedPosition, bounds)
      : getDefaultMeetingRecordingPillPosition(bounds);

    setMeasuredPosition(nextPosition, !!storedPosition);
  }, [getMeasuredBounds, setMeasuredPosition]);

  useEffect(() => {
    if (!isRecording || isViewingRecordingNote || !isControlPanelWindow()) return;

    const frame = window.requestAnimationFrame(resolveInitialPosition);
    const handleResize = () => {
      const bounds = getMeasuredBounds();
      const currentPosition = positionRef.current;
      if (!bounds || !currentPosition) return;

      setMeasuredPosition(clampMeetingRecordingPillPosition(currentPosition, bounds), true);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      dragStateRef.current = null;
      suppressReturnClickRef.current = false;
    };
  }, [
    getMeasuredBounds,
    isRecording,
    isViewingRecordingNote,
    resolveInitialPosition,
    setMeasuredPosition,
  ]);

  if (!isRecording || isViewingRecordingNote || !isControlPanelWindow()) {
    return null;
  }

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      await stopRecording();
    } finally {
      setIsStopping(false);
    }
  };

  const title = truncateTitle(recordingNoteTitle ?? "");
  const returnLabel = t("notes.meetingPill.returnToNote");
  const stopLabel = t("notes.editor.stop");

  const getCurrentPosition = () => {
    if (positionRef.current) return positionRef.current;

    const bounds = getMeasuredBounds();
    if (!bounds) return { x: 0, y: 8 };

    const nextPosition = getDefaultMeetingRecordingPillPosition(bounds);
    setMeasuredPosition(nextPosition);
    return nextPosition;
  };

  const handleDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const currentPosition = getCurrentPosition();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: currentPosition.x,
      originY: currentPosition.y,
      hasMoved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startClientX;
    const deltaY = event.clientY - dragState.startClientY;
    const distance = Math.hypot(deltaX, deltaY);

    if (!dragState.hasMoved && distance < DRAG_THRESHOLD_PX) return;

    dragState.hasMoved = true;
    suppressReturnClickRef.current = true;

    const bounds = getMeasuredBounds();
    if (!bounds) return;

    setMeasuredPosition(
      clampMeetingRecordingPillPosition(
        {
          x: dragState.originX + deltaX,
          y: dragState.originY + deltaY,
        },
        bounds
      )
    );
  };

  const handleDragPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (dragState.hasMoved && positionRef.current) {
      persistPosition(positionRef.current);
    }
  };

  const handleReturnClick = () => {
    if (suppressReturnClickRef.current) {
      suppressReturnClickRef.current = false;
      return;
    }

    onReturnToNote();
  };

  return createPortal(
    <div
      ref={pillRef}
      className="fixed z-30"
      style={
        {
          top: position ? position.y : 8,
          left: position ? position.x : "50%",
          transform: position ? undefined : "translateX(-50%)",
          WebkitAppRegion: "no-drag",
          animation: "grow-to-bar 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        } as React.CSSProperties
      }
    >
      <div
        className={cn(
          "flex items-center gap-2 h-9 px-3 rounded-md",
          "bg-background/95 dark:bg-surface-2/95",
          "border border-border/60 dark:border-border-subtle/70",
          "shadow-lg"
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={handleReturnClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onReturnToNote();
            }
          }}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerEnd}
          onPointerCancel={handleDragPointerEnd}
          aria-label={returnLabel}
          title={returnLabel}
          className={cn(
            "flex items-center gap-3 px-1 -mx-1 rounded-md cursor-grab active:cursor-grabbing select-none touch-none",
            "transition-colors",
            "hover:bg-foreground/[0.06] active:bg-foreground/[0.1]",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
          )}
        >
          <div className="flex items-end gap-0.75 h-4">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <div
                key={i}
                className="w-0.75 rounded-full bg-foreground/55 dark:bg-white/60 origin-bottom"
                style={{ height: computeBarHeight(micLevel, i) }}
              />
            ))}
          </div>
          <span className="text-xs font-medium text-foreground/80 truncate max-w-[12rem]">
            {title}
          </span>
        </div>

        <button
          type="button"
          onClick={handleStop}
          disabled={isStopping}
          aria-label={stopLabel}
          title={stopLabel}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-lg",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30",
            isStopping
              ? "bg-foreground/[0.04] text-muted-foreground/40 cursor-not-allowed"
              : "bg-foreground/[0.06] hover:bg-foreground/[0.1] active:bg-foreground/[0.14] text-foreground/70"
          )}
        >
          <Square size={12} fill="currentColor" />
        </button>
      </div>
    </div>,
    document.body
  );
}
