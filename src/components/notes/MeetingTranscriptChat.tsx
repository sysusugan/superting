import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "../lib/utils";
import type { TranscriptSegment } from "../../stores/meetingRecordingStore";
import {
  isTranscriptSpeakerLocked,
  type TranscriptSpeakerStatus,
} from "../../utils/transcriptSpeakerState";
import { countMatches, makeFindPattern } from "../../utils/transcriptFindReplace";
import {
  countFindMatches,
  getActiveSegmentFindMatch,
  getFindMatchPreview,
  type FindMatchPreview,
} from "../../utils/currentPageFind";
import { formatTranscriptTimestamp } from "../../utils/recordingTime";
import { buildLiveTranscriptItems } from "../../utils/liveTranscriptStream";
import { buildTranscriptSpeakerBlocks } from "../../utils/speakerAssignment";

const SPEAKER_COLORS = [
  "text-sky-500",
  "text-green-400",
  "text-purple-400",
  "text-orange-400",
  "text-pink-400",
  "text-cyan-400",
  "text-yellow-400",
  "text-red-400",
];

const SPEAKER_SWATCH_COLORS = [
  "bg-indigo-400",
  "bg-pink-300",
  "bg-emerald-400",
  "bg-amber-300",
  "bg-cyan-400",
  "bg-violet-400",
  "bg-rose-400",
  "bg-lime-300",
];

const STICKY_SCROLL_THRESHOLD_PX = 80;

const getEffectiveSpeakerKey = (
  segment: TranscriptSegment,
  speakerMappings?: Record<string, string>
): string => {
  const mapped = segment.speaker ? speakerMappings?.[segment.speaker] : undefined;
  if (segment.speakerName) return `name:${segment.speakerName.toLowerCase()}`;
  if (mapped) return `name:${mapped.toLowerCase()}`;
  if (segment.speaker) return `id:${segment.speaker}`;
  return `src:${segment.source}`;
};

const getSpeakerNumber = (speakerId: string) => {
  const match = speakerId.match(/speaker_(\d+)/);
  return match ? Number(match[1]) + 1 : 1;
};

export interface TranscriptSeekTarget {
  id: string;
  timestamp?: number;
}

function HighlightedText({
  text,
  searchTerm,
  ignoreCase,
  matchStartIndex = 0,
  activeMatchIndex = -1,
}: {
  text: string;
  searchTerm?: string;
  ignoreCase?: boolean;
  matchStartIndex?: number;
  activeMatchIndex?: number;
}) {
  const pattern = makeFindPattern(searchTerm || "", { ignoreCase });
  if (!pattern) return <>{text}</>;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let localMatchIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const globalMatchIndex = matchStartIndex + localMatchIndex;
    const isActive = activeMatchIndex === globalMatchIndex;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      <mark
        key={`${index}-${match[0]}`}
        data-find-active={isActive ? "true" : undefined}
        className={cn(
          "rounded-sm text-inherit px-0.5",
          isActive
            ? "bg-amber-300/90 ring-1 ring-amber-500/45 dark:bg-amber-400/55 dark:ring-amber-300/35"
            : "bg-amber-300/60 dark:bg-amber-400/30"
        )}
      >
        {match[0]}
      </mark>
    );
    localMatchIndex += 1;
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

function ActiveFindPreview({ preview }: { preview: FindMatchPreview }) {
  return (
    <div className="mt-1 max-w-full rounded-md border border-amber-300/55 bg-amber-50/90 px-2 py-1 text-[11px] leading-snug text-amber-950 shadow-sm dark:border-amber-300/25 dark:bg-amber-400/12 dark:text-amber-100">
      <span className="break-words">
        {preview.hasLeadingEllipsis && (
          <span className="text-amber-700/70 dark:text-amber-200/55">…</span>
        )}
        {preview.before}
        <mark className="rounded-sm bg-amber-300 px-0.5 text-inherit ring-1 ring-amber-500/40 dark:bg-amber-300/70 dark:ring-amber-200/30">
          {preview.match}
        </mark>
        {preview.after}
        {preview.hasTrailingEllipsis && (
          <span className="text-amber-700/70 dark:text-amber-200/55">…</span>
        )}
      </span>
    </div>
  );
}

const isLikelyEmail = (value: string) => /.+@.+\..+/.test(value.trim());

const nameFromEmail = (email: string) => email.split("@")[0] || email;

interface SpeakerProfileLite {
  id?: number;
  display_name: string;
  email: string | null;
  source?: "profile" | "name" | "transcript" | "session";
  speakerId?: string;
}

interface SpeakerPickerProps {
  speakerProfiles?: SpeakerProfileLite[];
  participants?: Array<{ email: string; displayName: string | null }>;
  onSelectName: (
    name: string,
    email?: string | null,
    profileId?: number,
    targetSpeakerId?: string
  ) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function AddContactButton({
  profile,
  onAttachEmail,
  t,
}: {
  profile: { id: number; display_name: string };
  onAttachEmail: (profileId: number, email: string | null) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const canSave = isLikelyEmail(draft);

  const submit = () => {
    if (!canSave) return;
    onAttachEmail(profile.id, draft.trim().toLowerCase());
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center mb-0.5 px-1.5 py-0.5 rounded-md text-[11px] outline-none cursor-pointer",
            "border border-dashed border-border/60 dark:border-white/15",
            "text-foreground/50 hover:text-foreground hover:border-border/90 dark:hover:border-white/30",
            "transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          {t("notes.speaker.addContact")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <div className="text-xs font-medium text-foreground truncate mb-2">
          {profile.display_name}
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={t("notes.speaker.emailPlaceholder")}
          className={cn(
            "w-full px-2 py-1.5 rounded-md bg-transparent text-xs text-foreground",
            "placeholder:text-foreground/25 outline-none",
            "border border-border/50 focus:border-border/90 transition-colors"
          )}
          autoFocus
          type="email"
        />
        <div className="flex justify-end gap-1 mt-2">
          <button
            onClick={() => setOpen(false)}
            className="px-2 py-1 rounded text-[11px] text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
          >
            {t("notes.speaker.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className={cn(
              "px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer",
              "border border-border/70 bg-background text-foreground hover:bg-foreground/[0.04]",
              "disabled:bg-muted/40 disabled:text-muted-foreground/40 disabled:pointer-events-none"
            )}
          >
            {t("notes.speaker.save")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SpeakerPicker({ speakerProfiles, participants, onSelectName, t }: SpeakerPickerProps) {
  const [search, setSearch] = useState("");
  const lower = search.toLowerCase();
  const trimmed = search.trim();
  const trimmedLower = trimmed.toLowerCase();

  const filteredParticipants = (participants || []).filter(
    (p) =>
      !search ||
      (p.displayName || "").toLowerCase().includes(lower) ||
      p.email.toLowerCase().includes(lower)
  );
  const filteredSessionSpeakers = (speakerProfiles || []).filter(
    (p) => p.source === "session" && (!search || p.display_name.toLowerCase().includes(lower))
  );
  const filteredProfiles = (speakerProfiles || []).filter(
    (p) =>
      p.source !== "session" &&
      (!search ||
        p.display_name.toLowerCase().includes(lower) ||
        (p.email && p.email.toLowerCase().includes(lower)))
  );

  const hasExactMatch =
    filteredParticipants.some(
      (p) =>
        (p.displayName || "").toLowerCase() === trimmedLower ||
        p.email.toLowerCase() === trimmedLower
    ) ||
    filteredSessionSpeakers.some((p) => p.display_name.toLowerCase() === trimmedLower) ||
    filteredProfiles.some(
      (p) =>
        p.display_name.toLowerCase() === trimmedLower ||
        (p.email && p.email.toLowerCase() === trimmedLower)
    );
  const canCreate = !!trimmed && !hasExactMatch;
  const inputIsEmail = isLikelyEmail(trimmed);

  const submitCreate = () => {
    if (!canCreate) return;
    if (inputIsEmail) {
      const email = trimmed.toLowerCase();
      onSelectName(nameFromEmail(email), email);
    } else {
      onSelectName(trimmed, null);
    }
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canCreate) {
      e.preventDefault();
      submitCreate();
    }
  };

  const isEmpty =
    !filteredSessionSpeakers.length &&
    !filteredParticipants.length &&
    !filteredProfiles.length &&
    !canCreate;

  return (
    <>
      <div className="p-2 border-b border-border/50">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("notes.speaker.nameOrEmailPlaceholder")}
          className="w-full px-2 py-1.5 rounded-md bg-transparent text-xs text-foreground placeholder:text-foreground/20 outline-none border-none appearance-none"
          autoFocus
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {filteredSessionSpeakers.length > 0 && (
          <div className="p-1 border-b border-border/30">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("notes.speaker.currentSessionSpeakers")}
            </div>
            {filteredSessionSpeakers.slice(0, 12).map((p) => (
              <button
                key={`session-${p.speakerId ?? p.display_name}`}
                onClick={() => onSelectName(p.display_name, null, undefined, p.speakerId)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/70 hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <span className="truncate flex-1 text-left">{p.display_name}</span>
              </button>
            ))}
          </div>
        )}
        {filteredParticipants.length > 0 && (
          <div className="p-1 border-b border-border/30">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("notes.speaker.meetingAttendees")}
            </div>
            {filteredParticipants.slice(0, 5).map((p) => (
              <button
                key={p.email}
                onClick={() => onSelectName(p.displayName || p.email.split("@")[0], p.email)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/70 hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <span className="truncate flex-1 text-left">{p.displayName || p.email}</span>
                {p.displayName && (
                  <span className="text-foreground/30 truncate text-[11px]">{p.email}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {filteredProfiles.length > 0 && (
          <div className="p-1 border-b border-border/30">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("notes.speaker.knownSpeakers")}
            </div>
            {filteredProfiles.slice(0, 5).map((p) => (
              <button
                key={`${p.source ?? "profile"}-${p.id ?? p.display_name}`}
                onClick={() =>
                  onSelectName(p.display_name, p.email, p.source === "profile" ? p.id : undefined)
                }
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/70 hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <span className="truncate flex-1 text-left">{p.display_name}</span>
                {p.email && (
                  <span className="text-foreground/30 truncate text-[11px]">{p.email}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {canCreate && (
          <div className="p-1">
            <button
              onClick={submitCreate}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/70 hover:bg-foreground/5 transition-colors cursor-pointer"
            >
              <span className="text-foreground/50 shrink-0">
                {t("notes.speaker.createNewPrefix")}
              </span>
              {inputIsEmail ? (
                <>
                  <span className="text-foreground truncate">{nameFromEmail(trimmed)}</span>
                  <span className="text-foreground/30 truncate text-[11px]">
                    {trimmed.toLowerCase()}
                  </span>
                </>
              ) : (
                <span className="text-foreground truncate">{trimmed}</span>
              )}
            </button>
          </div>
        )}
        {isEmpty && (
          <div className="px-3 py-4 text-center text-[11px] text-foreground/30">
            {t("notes.speaker.nameOrEmailPlaceholder")}
          </div>
        )}
      </div>
    </>
  );
}

function SpeakerLabel({
  speakerId,
  segment,
  mappedName,
  speakerProfiles,
  participants,
  colorIdx,
  isOriginallyYou,
  onMap,
  onMapSegment,
  onConfirm,
  onDismiss,
  variant = "compact",
  t,
}: {
  speakerId: string;
  segment: TranscriptSegment;
  mappedName?: string;
  speakerProfiles?: SpeakerProfileLite[];
  participants?: Array<{ email: string; displayName: string | null }>;
  colorIdx: number;
  isOriginallyYou: boolean;
  onMap?: (
    speakerId: string,
    name: string,
    email?: string | null,
    profileId?: number,
    targetSpeakerId?: string
  ) => void;
  onMapSegment?: (
    segmentId: string,
    name: string,
    email?: string | null,
    profileId?: number
  ) => void;
  onConfirm?: (speakerId: string, name: string, profileId: number) => void;
  onDismiss?: (speakerId: string) => void;
  variant?: "compact" | "inline";
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [bulkEditSpeaker, setBulkEditSpeaker] = useState(true);
  const speakerState =
    segment.speakerLocked || isTranscriptSpeakerLocked(segment)
      ? "locked"
      : segment.speakerStatus ||
        (segment.suggestedName && !mappedName
          ? "suggested"
          : segment.speakerName || mappedName
            ? "confirmed"
            : segment.speakerIsPlaceholder
              ? "provisional"
              : undefined);

  const hasSuggestion = !!segment.suggestedName && !mappedName;

  if (hasSuggestion) {
    return (
      <span className="group inline-flex items-center gap-1 mb-0.5 px-1">
        <span className="text-[11px] font-medium italic text-muted-foreground/60">
          {segment.suggestedName}
        </span>
        <button
          onClick={() =>
            onConfirm?.(speakerId, segment.suggestedName!, segment.suggestedProfileId!)
          }
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity cursor-pointer text-muted-foreground hover:text-emerald-500"
        >
          <Check size={12} />
        </button>
        <button
          onClick={() => onDismiss?.(speakerId)}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity cursor-pointer text-muted-foreground hover:text-destructive"
        >
          <X size={12} />
        </button>
      </span>
    );
  }

  const displayLabel =
    segment.speakerName ||
    mappedName ||
    (isOriginallyYou
      ? t("notes.speaker.you")
      : t("notes.speaker.label", { n: getSpeakerNumber(speakerId) }));
  const isUnmapped = !mappedName && !segment.speakerName;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 font-medium outline-none cursor-pointer",
            variant === "inline"
              ? "rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-foreground/6"
              : "mb-0.5 rounded-md px-1.5 py-0.5 text-[11px]",
            "border border-border/60 dark:border-white/20",
            "hover:bg-foreground/5 hover:border-border/90 dark:hover:border-white/30",
            "transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-ring",
            SPEAKER_COLORS[colorIdx],
            isUnmapped && "border-dashed",
            speakerState === "provisional" && "italic"
          )}
        >
          {displayLabel}
          {variant === "inline" && <Pencil size={12} className="opacity-55" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <SpeakerPicker
          speakerProfiles={speakerProfiles}
          participants={participants}
          onSelectName={(name, email, profileId, targetSpeakerId) => {
            if (bulkEditSpeaker || !onMapSegment) {
              onMap?.(speakerId, name, email, profileId, targetSpeakerId);
            } else {
              onMapSegment(segment.id, name, email, profileId);
            }
            setOpen(false);
          }}
          t={t}
        />
        {onMapSegment && (
          <div className="border-t border-border/40 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-foreground/65 cursor-pointer">
              <input
                type="checkbox"
                checked={bulkEditSpeaker}
                onChange={(event) => setBulkEditSpeaker(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="truncate">
                {t("notes.speaker.bulkEditSpeaker", { name: displayLabel })}
              </span>
            </label>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface MeetingTranscriptChatProps {
  segments: TranscriptSegment[];
  isEditing?: boolean;
  onSegmentsChange?: (segments: TranscriptSegment[]) => void;
  searchTerm?: string;
  ignoreCase?: boolean;
  activeSearchIndex?: number;
  onSearchMatchCountChange?: (count: number) => void;
  micPartial?: string;
  systemPartial?: string;
  speakerMappings?: Record<string, string>;
  speakerProfiles?: SpeakerProfileLite[];
  participants?: Array<{ email: string; displayName: string | null }>;
  activeSegmentId?: string | null;
  activeSegmentScrollKey?: number;
  isRecording?: boolean;
  isDiarizing?: boolean;
  recordingStartedAt?: number | null;
  timelineDurationSeconds?: number | null;
  onMapSpeaker?: (
    speakerId: string,
    displayName: string,
    email?: string | null,
    profileId?: number
  ) => void;
  onMapSegmentSpeaker?: (
    segmentId: string,
    displayName: string,
    email?: string | null,
    profileId?: number
  ) => void;
  onConfirmSuggestion?: (speakerId: string, suggestedName: string, profileId: number) => void;
  onDismissSuggestion?: (speakerId: string) => void;
  onAttachSpeakerEmail?: (profileId: number, email: string | null) => void;
  onSeekToSegment?: (target: TranscriptSeekTarget) => void;
  emptyMessage?: string;
}

export function MeetingTranscriptChat({
  segments,
  isEditing,
  onSegmentsChange,
  searchTerm,
  ignoreCase,
  activeSearchIndex = -1,
  onSearchMatchCountChange,
  micPartial,
  systemPartial,
  speakerMappings,
  speakerProfiles,
  participants,
  activeSegmentId,
  activeSegmentScrollKey = 0,
  isRecording,
  isDiarizing,
  recordingStartedAt,
  timelineDurationSeconds,
  onMapSpeaker,
  onMapSegmentSpeaker,
  onConfirmSuggestion,
  onDismissSuggestion,
  onAttachSpeakerEmail,
  onSeekToSegment,
  emptyMessage,
}: MeetingTranscriptChatProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const activeSegmentIdRef = useRef<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);

  useEffect(() => {
    activeSegmentIdRef.current = activeSegmentId ?? null;
  }, [activeSegmentId]);

  useEffect(() => {
    if (activeSegmentScrollKey <= 0) return;
    const requestedSegmentId = activeSegmentIdRef.current;
    if (!requestedSegmentId) return;
    const container = scrollRef.current;
    if (!container) return;
    const target = Array.from(container.querySelectorAll<HTMLElement>("[data-segment-ids]")).find(
      (element) => (element.dataset.segmentIds || "").split(" ").includes(requestedSegmentId)
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSegmentScrollKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateStickyScroll = () => {
      shouldStickToBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_SCROLL_THRESHOLD_PX;
    };

    updateStickyScroll();
    el.addEventListener("scroll", updateStickyScroll);
    return () => el.removeEventListener("scroll", updateStickyScroll);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldStickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [segments, micPartial, systemPartial]);

  const hasContent = segments.length > 0 || micPartial || systemPartial;
  const colorByKey = useMemo(() => {
    const map = new Map<string, number>();
    let nextIdx = 0;
    for (const segment of segments) {
      if (segment.source === "mic" && !segment.speaker) continue;
      if (segment.speaker === "you") continue;
      const key = getEffectiveSpeakerKey(segment, speakerMappings);
      if (!map.has(key)) {
        map.set(key, nextIdx % SPEAKER_COLORS.length);
        nextIdx += 1;
      }
    }
    return map;
  }, [segments, speakerMappings]);

  const timelineStartedAt = useMemo(() => {
    if (recordingStartedAt) return recordingStartedAt;
    return (
      segments.find(
        (segment) =>
          typeof segment.timestamp === "number" &&
          Number.isFinite(segment.timestamp) &&
          segment.timestamp > 1_000_000_000
      )?.timestamp ?? null
    );
  }, [recordingStartedAt, segments]);

  const speakerBlocks = useMemo(
    () =>
      buildTranscriptSpeakerBlocks(
        segments,
        speakerMappings,
        {
          you: t("notes.speaker.you"),
          speaker: (n) => t("notes.speaker.label", { n }),
          unknownTrack: t("notes.speaker.unknownTrack"),
          unmatchedSpeaker: t("notes.speaker.unmatchedSpeaker"),
        },
        {
          maxBlockDurationSeconds: 60,
          maxBlockTextLength: 420,
          selfFallback: false,
          timelineDurationSeconds,
        }
      ),
    [segments, speakerMappings, t, timelineDurationSeconds]
  );
  const renderedSearchItems = isEditing ? segments : speakerBlocks;

  const segmentSearchMeta = useMemo(() => {
    let running = 0;
    return renderedSearchItems.map((item) => {
      const count = countFindMatches(item.text, searchTerm || "", { ignoreCase });
      const start = running;
      running += count;
      return { start, count };
    });
  }, [ignoreCase, renderedSearchItems, searchTerm]);

  const totalSearchMatches = useMemo(() => {
    if (segmentSearchMeta.length === 0) return 0;
    const last = segmentSearchMeta[segmentSearchMeta.length - 1];
    return last.start + last.count;
  }, [segmentSearchMeta]);

  const activeSegmentFindMatch = useMemo(
    () =>
      getActiveSegmentFindMatch(renderedSearchItems, searchTerm || "", activeSearchIndex, {
        ignoreCase,
      }),
    [activeSearchIndex, ignoreCase, renderedSearchItems, searchTerm]
  );

  useEffect(() => {
    onSearchMatchCountChange?.(totalSearchMatches);
  }, [onSearchMatchCountChange, totalSearchMatches]);

  useEffect(() => {
    if (activeSearchIndex < 0) return;
    const frameId = window.requestAnimationFrame(() => {
      const active = scrollRef.current?.querySelector<HTMLElement>("[data-find-active='true']");
      active?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSearchIndex]);

  if (!hasContent) {
    return (
      <div className="h-full flex items-center justify-center px-5">
        <p className="text-xs text-muted-foreground/40 select-none">
          {emptyMessage || t("notes.editor.conversationWillAppear")}
        </p>
      </div>
    );
  }

  const updateSegmentText = (segmentId: string, text: string) => {
    onSegmentsChange?.(
      segments.map((segment) => (segment.id === segmentId ? { ...segment, text } : segment))
    );
  };

  if (isRecording) {
    const liveItems = buildLiveTranscriptItems(segments, micPartial, systemPartial);

    return (
      <div className="h-full relative">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto bg-slate-50/40 px-8 pt-4 pb-20 agent-chat-scroll"
          data-transcript-mode="live"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            {liveItems.map((item) => {
              const timestampLabel =
                !item.pending && item.timestamp != null
                  ? formatTranscriptTimestamp(
                      item.timestamp,
                      timelineStartedAt,
                      timelineDurationSeconds
                    )
                  : null;

              return (
                <section
                  key={item.id}
                  className="min-w-0"
                  data-live-transcript-item="true"
                  data-live-transcript-pending={item.pending ? "true" : undefined}
                >
                  {timestampLabel && (
                    <div className="mb-1.5 text-xs tabular-nums leading-none text-slate-400">
                      {timestampLabel}
                    </div>
                  )}
                  <p
                    className={cn(
                      "whitespace-pre-wrap text-sm leading-6 tracking-normal text-slate-900",
                      item.pending && "text-slate-500"
                    )}
                  >
                    {item.text}
                    {item.pending && (
                      <span
                        className="ml-1 inline-block h-3.5 w-[2px] align-middle bg-slate-500/45"
                        style={{ animation: "agent-cursor-blink 800ms steps(1) infinite" }}
                      />
                    )}
                  </p>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {isDiarizing && !hintDismissed && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2.5 py-1 rounded-md border border-border bg-background/95 backdrop-blur shadow-sm text-xs text-foreground">
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
          <span>{t("notes.speaker.pill.finalizing")}</span>
          <button
            onClick={() => setHintDismissed(true)}
            className="text-foreground/40 hover:text-foreground/70 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto bg-white px-8 pt-3 pb-16 agent-chat-scroll"
        data-transcript-mode="final"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          {(isEditing ? segments : speakerBlocks).map((item, i) => {
            const blockSegments = "segments" in item ? item.segments : [item];
            const segment = blockSegments[0];
            const itemText = "segments" in item ? item.text : item.text;
            const searchMeta = segmentSearchMeta[i] ?? { start: 0, count: 0 };
            const hasSpeaker = !!segment.speaker;
            const isOriginallyYou = segment.speaker === "you";
            const effectiveKey = getEffectiveSpeakerKey(segment, speakerMappings);
            const colorIdx =
              hasSpeaker && !isOriginallyYou ? (colorByKey.get(effectiveKey) ?? 0) : 0;
            const hasSearchMatch =
              isEditing &&
              !!searchTerm &&
              countMatches(segment.text, searchTerm, { ignoreCase }) > 0;
            const hasActiveSearchMatch =
              activeSearchIndex >= searchMeta.start &&
              activeSearchIndex < searchMeta.start + searchMeta.count;
            const activeSearchPreview =
              isEditing && hasActiveSearchMatch && activeSegmentFindMatch?.segmentId === segment.id
                ? getFindMatchPreview(
                    segment.text,
                    searchTerm || "",
                    activeSegmentFindMatch.localMatchIndex,
                    36,
                    { ignoreCase }
                  )
                : null;

            const activeName = segment.speakerName || speakerMappings?.[segment.speaker!];
            const matchedProfile =
              activeName && speakerProfiles
                ? speakerProfiles.find((p) => p.id != null && p.display_name === activeName)
                : undefined;
            const canAddContact =
              !!matchedProfile &&
              matchedProfile.id != null &&
              !matchedProfile.email &&
              !!onAttachSpeakerEmail;
            const timestampLabel = formatTranscriptTimestamp(
              segment.timestamp,
              timelineStartedAt,
              timelineDurationSeconds
            );
            const fallbackSpeakerLabel =
              segment.speakerMatchStatus === "unmatched"
                ? t("notes.speaker.unmatchedSpeaker")
                : segment.source === "mic"
                  ? t("notes.speaker.label", { n: 1 })
                  : t("notes.speaker.them");
            const blockId = "segments" in item ? item.id : segment.id;
            const isActiveSegment =
              activeSegmentId === blockId ||
              blockSegments.some(
              (blockSegment) => activeSegmentId === blockSegment.id
            );
            const seekTarget = { id: blockId, timestamp: item.timestamp };

            const labelElement = (
              <div className="flex min-w-0 items-center gap-2">
                {hasSpeaker ? (
                  <SpeakerLabel
                    speakerId={segment.speaker!}
                    segment={segment}
                    mappedName={speakerMappings?.[segment.speaker!]}
                    speakerProfiles={speakerProfiles}
                    participants={participants}
                    colorIdx={colorIdx}
                    isOriginallyYou={isOriginallyYou}
                    onMap={onMapSpeaker}
                    onMapSegment={onMapSegmentSpeaker}
                    onConfirm={onConfirmSuggestion}
                    onDismiss={onDismissSuggestion}
                    variant="inline"
                    t={t}
                  />
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">
                    {fallbackSpeakerLabel}
                  </span>
                )}
                {timestampLabel && (
                  <span className="text-sm tabular-nums text-muted-foreground/55">
                    {timestampLabel}
                  </span>
                )}
                {canAddContact && matchedProfile && matchedProfile.id != null && (
                  <AddContactButton
                    profile={{ id: matchedProfile.id, display_name: matchedProfile.display_name }}
                    onAttachEmail={onAttachSpeakerEmail!}
                    t={t}
                  />
                )}
              </div>
            );

            return (
              <div
                key={"segments" in item ? `block-${item.id}` : segment.id}
                data-segment-id={segment.id}
                data-segment-ids={[blockId, ...blockSegments.map((blockSegment) => blockSegment.id)]
                  .filter(Boolean)
                  .join(" ")}
                className={cn(
                  "group grid grid-cols-[10px_minmax(0,1fr)] gap-3 border-l-2 border-transparent px-2 py-1 transition-colors",
                  onSeekToSegment && "cursor-pointer hover:bg-slate-50/80",
                  isActiveSegment && "border-l-indigo-500 bg-indigo-50/70"
                )}
                onClick={() => onSeekToSegment?.(seekTarget)}
                style={{ animation: "agent-message-in 200ms ease-out both" }}
              >
                <div className="relative pt-1.5">
                  <span
                    className={cn(
                      "block h-2.5 w-2.5 rounded-full",
                      SPEAKER_SWATCH_COLORS[colorIdx % SPEAKER_SWATCH_COLORS.length]
                    )}
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  {labelElement}
                  {isEditing ? (
                    <div className="mt-2">
                      <textarea
                        value={segment.text}
                        onChange={(event) => updateSegmentText(segment.id, event.target.value)}
                        rows={Math.max(
                          1,
                          Math.min(hasActiveSearchMatch ? 10 : 6, segment.text.split("\n").length)
                        )}
                        data-find-active={hasActiveSearchMatch ? "true" : undefined}
                        className={cn(
                          "w-full min-w-56 resize-y px-3 py-2 outline-none transition-colors",
                          "rounded-md border text-sm leading-6 shadow-sm",
                          "focus-visible:ring-1 focus-visible:ring-ring/70",
                          "bg-white text-slate-950 border-slate-200 placeholder:text-slate-400",
                          hasSearchMatch && "ring-1 ring-amber-300/70 dark:ring-amber-400/45",
                          hasActiveSearchMatch &&
                            "ring-2 ring-amber-400/85 shadow-[0_0_0_3px_rgba(251,191,36,0.18)] dark:ring-amber-300/65"
                        )}
                      />
                      {activeSearchPreview && <ActiveFindPreview preview={activeSearchPreview} />}
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "mt-0.5 whitespace-pre-wrap text-[13px] leading-6 text-slate-950 transition-colors",
                        isActiveSegment && "bg-indigo-50/50"
                      )}
                    >
                      <HighlightedText
                        text={itemText}
                        searchTerm={searchTerm}
                        ignoreCase={ignoreCase}
                        matchStartIndex={searchMeta.start}
                        activeMatchIndex={activeSearchIndex}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
