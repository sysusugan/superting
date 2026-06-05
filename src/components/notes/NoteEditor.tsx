import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  FileAudio,
  Loader2,
  FileText,
  Sparkles,
  AlignLeft,
  MessageSquareText,
  Calendar,
  LinkIcon,
  FolderOpen,
  Search,
  ChevronUp,
  ChevronDown,
  Plus,
  Check,
  Share2,
  Pencil,
  X,
  Filter,
  FileUp,
} from "lucide-react";
import ShareNoteDialog from "./ShareNoteDialog";
import { useShareCacheEntry } from "../../stores/noteStore";
import { SHARING_ENABLED } from "../../lib/features";
import { RichTextEditor } from "../ui/RichTextEditor";
import type { Editor } from "@tiptap/react";
import { MeetingTranscriptChat, SelectionBar } from "./MeetingTranscriptChat";
import type { TranscriptSegment } from "../../stores/meetingRecordingStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useToast } from "../ui/useToast";
import { cn } from "../lib/utils";
import type { NoteItem, FolderItem } from "../../types/electron";
import type { ActionProcessingState } from "../../hooks/useActionProcessing";
import type { ActionOutputTarget } from "../../stores/actionProcessingCore";
import ActionProcessingOverlay from "./ActionProcessingOverlay";
import NoteBottomBar from "./NoteBottomBar";
import EmbeddedChat, { type EmbeddedChatMode } from "./EmbeddedChat";
import { selectEmbeddedChatTranscript } from "./embeddedChatTranscript";
import { useEmbeddedChat } from "../../hooks/useEmbeddedChat";
import { normalizeDbDate } from "../../utils/dateFormatting";
import { parseTranscriptSegments } from "../../utils/parseTranscriptSegments";
import {
  getFindMatches,
  getNextFindIndex,
  replaceAllFindMatches,
  replaceFindMatchAt,
} from "../../utils/currentPageFind";
import {
  applyTranscriptSpeakerPatch,
  lockTranscriptSpeaker,
  mergeTranscriptSegments,
  serializeTranscriptSegments,
} from "../../utils/transcriptSpeakerState";
import { parseImportedTranscriptTxt } from "../../utils/importTranscriptTxt";
import {
  assignSelectedTranscriptSegments,
  assignSpeakerGroupName,
  filterTranscriptSegmentsBySpeaker,
  getTranscriptSpeakerFilterOptions,
  type TranscriptSpeakerFilterOption,
} from "../../utils/speakerAssignment";
import NoteParticipants from "./NoteParticipants";
import type { CalendarAttendee } from "../../types/calendar";
import { countMatches } from "../../utils/transcriptFindReplace";

function formatNoteDate(dateStr: string): string {
  const date = normalizeDbDate(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} \u00b7 ${timePart}`;
}

function formatShortDate(dateStr: string): string {
  const date = normalizeDbDate(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTimeLocalValue(dateStr: string): string {
  const date = normalizeDbDate(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export interface Enhancement {
  content: string;
  isStale: boolean;
  onChange: (content: string) => void;
}

type MeetingViewMode = "raw" | "transcript" | "enhanced";
type ImportTarget = "transcript" | "note";

type SpeakerNameEntry = {
  id: number;
  display_name: string;
  email: string | null;
};

type SpeakerOption = {
  id?: number;
  display_name: string;
  email: string | null;
  source?: "profile" | "name" | "transcript";
};

const FILTER_SWATCH_CLASSES = [
  "bg-blue-500/80",
  "bg-green-500/80",
  "bg-purple-500/80",
  "bg-orange-500/80",
  "bg-pink-500/80",
  "bg-cyan-500/80",
  "bg-yellow-500/80",
  "bg-red-500/80",
];

function TranscriptSpeakerFilter({
  options,
  selectedKeys,
  onChange,
  t,
}: {
  options: TranscriptSpeakerFilterOption[];
  selectedKeys: Set<string> | null;
  onChange: (keys: Set<string> | null) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const allSelected = selectedKeys === null || selectedKeys.size === options.length;
  const activeCount = allSelected ? options.length : selectedKeys.size;

  const toggleAll = () => {
    onChange(null);
  };

  const toggleOne = (key: string) => {
    const current = allSelected
      ? new Set(options.map((option) => option.key))
      : new Set(selectedKeys);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    onChange(current.size === options.length ? null : current);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("notes.speaker.filterAria")}
          className={cn(
            "h-7 inline-flex items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
            allSelected
              ? "bg-foreground/5 text-foreground/55 hover:bg-foreground/9 hover:text-foreground/75"
              : "bg-primary/10 text-primary hover:bg-primary/15"
          )}
        >
          <Filter size={13} />
          <span className="hidden sm:inline">{t("notes.speaker.filter")}</span>
          {!allSelected && <span className="tabular-nums">{activeCount}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-2">
        <button
          type="button"
          onClick={toggleAll}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
        >
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded border",
              allSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background"
            )}
          >
            {allSelected && <Check size={11} strokeWidth={3} />}
          </span>
          <span className="font-medium">{t("notes.speaker.filterAll")}</span>
        </button>
        <div className="my-1 h-px bg-border/50" />
        <div className="max-h-64 overflow-y-auto">
          {options.map((option, index) => {
            const checked = allSelected || selectedKeys.has(option.key);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => toggleOne(option.key)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background"
                  )}
                >
                  {checked && <Check size={11} strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-md text-[11px] font-semibold text-white",
                    FILTER_SWATCH_CLASSES[index % FILTER_SWATCH_CLASSES.length]
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface NoteEditorProps {
  note: NoteItem;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  isSaving: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onExportNote?: (format: "md" | "txt" | "pdf") => void;
  onExportTranscript?: (format: "txt" | "srt" | "json" | "md") => void;
  onDownloadOriginalAudio?: () => void;
  onShowOriginalAudioInFolder?: () => void;
  onManageSavedAudio?: () => void;
  hasDownloadableAudio?: boolean;
  enhancement?: Enhancement;
  actionPicker?: React.ReactNode;
  actionProcessingState?: ActionProcessingState;
  actionName?: string | null;
  actionOutputTarget?: ActionOutputTarget | null;
  diarizationSessionId?: string | null;
  recordingStartedAt?: number | null;
  meetingTranscript?: string;
  meetingSegments?: TranscriptSegment[];
  meetingMicPartial?: string;
  meetingSystemPartial?: string;
  meetingSystemPartialSpeakerId?: string | null;
  meetingSystemPartialSpeakerName?: string | null;
  onLiveSpeakerLock?: (speakerId: string, displayName: string) => void;
  liveTranscript?: string;
  sessionDiarizationEnabled?: boolean;
  sessionExpectedCount?: number;
  userTouchedStepper?: boolean;
  onSetSessionDiarizationEnabled?: (enabled: boolean) => void;
  onSetSessionExpectedCount?: (count: number) => void;
  folderName?: string | null;
  calendarEventName?: string | null;
  folders?: FolderItem[];
  onMoveToFolder?: (noteId: number, folderId: number) => void;
  onCreateFolderAndMove?: (noteId: number, folderName: string) => void;
  onRecordedAtChange?: (noteId: number, recordedAt: string) => Promise<void>;
}

export default function NoteEditor({
  note,
  onTitleChange,
  onContentChange,
  isSaving,
  isRecording,
  isProcessing,
  onStartRecording,
  onStopRecording,
  onExportNote,
  onExportTranscript,
  onDownloadOriginalAudio,
  onShowOriginalAudioInFolder,
  onManageSavedAudio,
  hasDownloadableAudio = !!note.source_file,
  enhancement,
  actionPicker,
  actionProcessingState,
  actionName,
  actionOutputTarget,
  diarizationSessionId,
  recordingStartedAt,
  meetingTranscript,
  meetingSegments,
  meetingMicPartial,
  meetingSystemPartial,
  meetingSystemPartialSpeakerId,
  meetingSystemPartialSpeakerName,
  onLiveSpeakerLock,
  liveTranscript,
  sessionDiarizationEnabled,
  sessionExpectedCount,
  userTouchedStepper,
  onSetSessionDiarizationEnabled,
  onSetSessionExpectedCount,
  folderName,
  calendarEventName,
  folders,
  onMoveToFolder,
  onCreateFolderAndMove,
  onRecordedAtChange,
}: NoteEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<MeetingViewMode>("raw");
  const [chatMode, setChatMode] = useState<EmbeddedChatMode>("hidden");
  const [folderSearch, setFolderSearch] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isRecordedDateOpen, setIsRecordedDateOpen] = useState(false);
  const [recordedDateInput, setRecordedDateInput] = useState("");
  const [isSavingRecordedDate, setIsSavingRecordedDate] = useState(false);
  const [isDiarizing, setIsDiarizing] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);
  const [isTranscriptSaving, setIsTranscriptSaving] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [queuedImportTarget, setQueuedImportTarget] = useState<ImportTarget | null>(null);
  const [isImportingNote, setIsImportingNote] = useState(false);
  const [editableTranscriptText, setEditableTranscriptText] = useState("");
  const [editableTranscriptSegments, setEditableTranscriptSegments] = useState<TranscriptSegment[]>(
    []
  );
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [activeFindIndex, setActiveFindIndex] = useState(-1);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [selectedSpeakerFilterKeys, setSelectedSpeakerFilterKeys] = useState<Set<string> | null>(
    null
  );
  const [richTextReplaceRequest, setRichTextReplaceRequest] = useState<{
    id: number;
    mode: "current" | "all";
    query: string;
    replacement: string;
    activeIndex: number;
    ignoreCase: boolean;
  } | null>(null);
  const shareCache = useShareCacheEntry(note.cloud_id);
  const isShared = (shareCache?.share.visibility ?? "private") !== "private";
  const [diarizedSegments, setDiarizedSegments] = useState<TranscriptSegment[] | null>(null);
  const [speakerMappings, setSpeakerMappings] = useState<Record<string, string>>({});
  const [speakerProfiles, setSpeakerProfiles] = useState<
    Array<{ id: number; display_name: string; email: string | null }>
  >([]);
  const [speakerNames, setSpeakerNames] = useState<SpeakerNameEntry[]>([]);
  const editorRef = useRef<Editor | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const plainTranscriptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const queuedImportTargetRef = useRef<ImportTarget | null>(null);
  const replaceRequestIdRef = useRef(0);
  const displaySegmentsRef = useRef<TranscriptSegment[]>([]);
  const effectiveTranscript = selectEmbeddedChatTranscript({
    liveTranscript,
    meetingTranscript,
    savedTranscript: note.transcript,
  });

  const embeddedChat = useEmbeddedChat({
    noteId: note.id,
    folderId: note.folder_id,
    noteTitle: note.title,
    noteContent: note.content,
    noteEnhancedContent: note.enhanced_content,
    noteTranscript: effectiveTranscript || undefined,
    noteUpdatedAt: note.updated_at,
  });
  const titleRef = useRef<HTMLDivElement>(null);
  const prevNoteIdRef = useRef<number>(note.id);

  const scheduleUiUpdate = useCallback((callback: () => void) => {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const hasMeetingTranscript = !isRecording && !!effectiveTranscript;

  const filteredFolders = useMemo(
    () =>
      folderSearch && folders
        ? folders.filter((f) => f.name.toLowerCase().includes(folderSearch.toLowerCase()))
        : (folders ?? []),
    [folders, folderSearch]
  );

  const displaySegments = useMemo<TranscriptSegment[]>(() => {
    if (isRecording) return meetingSegments ?? [];
    if (diarizedSegments && diarizedSegments.length > 0) return diarizedSegments;
    if (meetingSegments && meetingSegments.length > 0) return meetingSegments;
    return parseTranscriptSegments(note.transcript || "");
  }, [diarizedSegments, isRecording, meetingSegments, note.transcript]);

  useEffect(() => {
    displaySegmentsRef.current = displaySegments;
  }, [displaySegments]);

  const hasChatSegments = displaySegments.length > 0;
  const transcriptIsStructured = hasChatSegments;
  const renderedTranscriptSegments = isTranscriptEditing
    ? editableTranscriptSegments
    : displaySegments;
  const speakerFilterOptions = useMemo(
    () =>
      getTranscriptSpeakerFilterOptions(displaySegments, speakerMappings, {
        you: t("notes.speaker.you"),
        speaker: (n) => t("notes.speaker.label", { n }),
      }),
    [displaySegments, speakerMappings, t]
  );
  const visibleTranscriptSegments = useMemo(
    () =>
      isTranscriptEditing
        ? renderedTranscriptSegments
        : filterTranscriptSegmentsBySpeaker(renderedTranscriptSegments, selectedSpeakerFilterKeys),
    [isTranscriptEditing, renderedTranscriptSegments, selectedSpeakerFilterKeys]
  );
  const activeTranscriptText = transcriptIsStructured
    ? visibleTranscriptSegments.map((segment) => segment.text).join("\n")
    : editableTranscriptText;
  const transcriptMatchCount = useMemo(
    () => countMatches(activeTranscriptText, findText, { ignoreCase }),
    [activeTranscriptText, findText, ignoreCase]
  );
  const plainTranscriptMatches = useMemo(
    () => getFindMatches(editableTranscriptText, findText, { ignoreCase }),
    [editableTranscriptText, findText, ignoreCase]
  );
  const hasTranscriptEditControls = !!effectiveTranscript;
  const canEditTranscript = hasTranscriptEditControls && !isRecording;
  const canImportNoteFile = !isTranscriptEditing;
  const canImportTranscriptFile = !isRecording && !isTranscriptEditing;

  const knownSpeakers = useMemo<SpeakerOption[]>(() => {
    const seen = new Set<string>();
    const list: SpeakerOption[] = [];
    for (const p of speakerProfiles) {
      const key = p.display_name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ ...p, source: "profile" });
    }
    for (const p of speakerNames) {
      const key = p.display_name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ ...p, source: "name" });
    }
    for (const segment of displaySegments) {
      if (!segment.speaker) continue;
      const name = segment.speakerName || speakerMappings[segment.speaker];
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ display_name: name, email: null, source: "transcript" });
    }
    return list;
  }, [displaySegments, speakerMappings, speakerNames, speakerProfiles]);

  useEffect(() => {
    setSelectedSpeakerFilterKeys(null);
    setActiveFindIndex(-1);
  }, [note.id, isRecording, isTranscriptEditing]);

  useEffect(() => {
    setSelectedSpeakerFilterKeys((prev) => {
      if (!prev) return prev;
      const available = new Set(speakerFilterOptions.map((option) => option.key));
      const next = new Set([...prev].filter((key) => available.has(key)));
      return next.size === speakerFilterOptions.length ? null : next;
    });
  }, [speakerFilterOptions]);

  useEffect(() => {
    setActiveFindIndex(-1);
  }, [selectedSpeakerFilterKeys]);

  const parsedParticipants = useMemo<CalendarAttendee[]>(() => {
    try {
      return note.participants ? JSON.parse(note.participants) : [];
    } catch {
      return [];
    }
  }, [note.participants]);

  const refreshSpeakerProfiles = useCallback(() => {
    window.electronAPI?.getSpeakerProfiles?.().then((profiles) => {
      setSpeakerProfiles(
        (profiles || []).map((profile) => ({
          id: profile.id,
          display_name: profile.display_name,
          email: profile.email,
        }))
      );
    });
  }, []);

  const refreshSpeakerNames = useCallback(() => {
    window.electronAPI?.getSpeakerNames?.().then((names) => {
      setSpeakerNames(
        (names || []).map((entry) => ({
          id: entry.id,
          display_name: entry.display_name,
          email: entry.email,
        }))
      );
    });
  }, []);

  const rememberSpeakerName = useCallback(
    async (displayName: string, email?: string | null) => {
      const result = await window.electronAPI?.upsertSpeakerName?.(displayName, email ?? null);
      if (result?.success && result.entry) {
        setSpeakerNames((prev) => {
          const next = prev.filter((entry) => entry.id !== result.entry!.id);
          return [
            ...next,
            {
              id: result.entry!.id,
              display_name: result.entry!.display_name,
              email: result.entry!.email,
            },
          ];
        });
      } else {
        refreshSpeakerNames();
      }
    },
    [refreshSpeakerNames]
  );

  const prevProcessingStateRef = useRef(actionProcessingState);
  useEffect(() => {
    let cancelScheduledUpdate: (() => void) | undefined;

    if (prevProcessingStateRef.current === "processing" && actionProcessingState === "success") {
      cancelScheduledUpdate = scheduleUiUpdate(() =>
        setViewMode(actionOutputTarget === "content" ? "raw" : "enhanced")
      );
    }
    prevProcessingStateRef.current = actionProcessingState;

    return cancelScheduledUpdate;
  }, [actionOutputTarget, actionProcessingState, scheduleUiUpdate]);

  useEffect(() => {
    if (note.id !== prevNoteIdRef.current) {
      prevNoteIdRef.current = note.id;
      return scheduleUiUpdate(() => {
        setChatMode("hidden");
        setDiarizedSegments(null);
        setIsDiarizing(false);
        setIsTranscriptEditing(false);
        setEditableTranscriptText("");
        setEditableTranscriptSegments([]);
        setFindText("");
        setReplaceText("");
        setSpeakerMappings({});
        if (!isRecording) {
          setViewMode("raw");
        }
        if (titleRef.current && titleRef.current.textContent !== note.title) {
          titleRef.current.textContent = note.title || "";
        }
        editorRef.current?.commands.focus();
      });
    }
  }, [isRecording, note.id, note.title, scheduleUiUpdate]);

  useEffect(() => {
    window.electronAPI?.getSpeakerMappings?.(note.id).then((mappings) => {
      const map: Record<string, string> = {};
      for (const m of mappings || []) map[m.speaker_id] = m.display_name;
      setSpeakerMappings(map);
    });
    refreshSpeakerProfiles();
    refreshSpeakerNames();
  }, [note.id, refreshSpeakerNames, refreshSpeakerProfiles]);

  useEffect(() => {
    if (!isFindOpen) return;
    const frameId = window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isFindOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = navigator.platform.startsWith("Mac") ? event.metaKey : event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      event.stopPropagation();
      setIsFindOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    setActiveFindIndex(-1);
    setFindMatchCount(0);
  }, [note.id, viewMode]);

  useEffect(() => {
    if (viewMode === "transcript") {
      setFindMatchCount(transcriptMatchCount);
    }
  }, [transcriptMatchCount, viewMode]);

  useEffect(() => {
    setActiveFindIndex((current) => {
      if (!findText || findMatchCount <= 0) return -1;
      if (current < 0) return 0;
      if (current >= findMatchCount) return findMatchCount - 1;
      return current;
    });
  }, [findMatchCount, findText]);

  useEffect(() => {
    if (viewMode !== "transcript" || !isTranscriptEditing || transcriptIsStructured) return;
    if (activeFindIndex < 0) return;
    const match = plainTranscriptMatches[activeFindIndex];
    const textarea = plainTranscriptTextareaRef.current;
    if (!match || !textarea) return;

    textarea.focus();
    textarea.setSelectionRange(match.index, match.index + match.length);
  }, [
    activeFindIndex,
    isTranscriptEditing,
    plainTranscriptMatches,
    transcriptIsStructured,
    viewMode,
  ]);

  useEffect(() => {
    if (titleRef.current && titleRef.current.textContent !== note.title) {
      titleRef.current.textContent = note.title || "";
    }
  }, [note.title]);

  const prevRecordingForDiarizationRef = useRef(false);
  useEffect(() => {
    if (prevRecordingForDiarizationRef.current && !isRecording && diarizationSessionId) {
      const cancelScheduledUpdate = scheduleUiUpdate(() => setIsDiarizing(true));
      prevRecordingForDiarizationRef.current = isRecording;
      return cancelScheduledUpdate;
    }
    prevRecordingForDiarizationRef.current = isRecording;
  }, [diarizationSessionId, isRecording, scheduleUiUpdate]);

  useEffect(() => {
    const expectedSession = diarizationSessionId;
    const cleanup = window.electronAPI?.onMeetingDiarizationComplete?.(async (data) => {
      if (!expectedSession || data?.sessionId !== expectedSession) return;

      setIsDiarizing(false);

      if (!data?.segments?.length) return;

      const persisted = await window.electronAPI?.getNote?.(note.id);
      const existing = persisted?.transcript
        ? parseTranscriptSegments(persisted.transcript)
        : displaySegmentsRef.current;

      const enriched = mergeTranscriptSegments(
        existing,
        data.segments.map((s: any, i: number) => ({
          ...s,
          id: s.id || `diarized-${i}`,
        }))
      );
      setDiarizedSegments(enriched);

      window.electronAPI.updateNote(note.id, { transcript: serializeTranscriptSegments(enriched) });

      if (data.speakerEmbeddings) {
        window.electronAPI?.saveNoteSpeakerEmbeddings?.(note.id, data.speakerEmbeddings);
      }

      const autoMappings: Record<string, string> = {};
      for (const s of enriched) {
        if (s.speakerName && s.speaker) autoMappings[s.speaker] = s.speakerName;
      }
      if (Object.keys(autoMappings).length > 0) {
        setSpeakerMappings((prev) => ({ ...autoMappings, ...prev }));
      }
    });
    return () => cleanup?.();
  }, [note.id, diarizationSessionId]);

  const persistDisplaySegments = useCallback(
    async (nextSegments: TranscriptSegment[], updateOverlay = true) => {
      if (updateOverlay) {
        setDiarizedSegments(nextSegments);
      }
      await window.electronAPI?.updateNote(note.id, {
        transcript: serializeTranscriptSegments(nextSegments),
      });
    },
    [note.id]
  );

  const handleMapSpeaker = useCallback(
    async (
      speakerId: string,
      displayName: string,
      email?: string | null,
      profileId?: number | null
    ) => {
      await rememberSpeakerName(displayName, email ?? null);
      setSpeakerMappings((prev) => ({ ...prev, [speakerId]: displayName }));
      await window.electronAPI?.setSpeakerMapping?.(
        note.id,
        speakerId,
        displayName,
        email,
        profileId
      );

      if (isRecording) {
        onLiveSpeakerLock?.(speakerId, displayName);
        refreshSpeakerProfiles();
        refreshSpeakerNames();
        return;
      }

      const currentSegments = displaySegments.map((s) =>
        s.speaker === speakerId
          ? lockTranscriptSpeaker(s, {
              speakerName: displayName,
              speaker: speakerId,
              speakerIsPlaceholder: false,
              suggestedName: undefined,
              suggestedProfileId: undefined,
            })
          : s
      );
      await persistDisplaySegments(currentSegments, !!diarizedSegments || !isRecording);

      refreshSpeakerProfiles();
      refreshSpeakerNames();
    },
    [
      diarizedSegments,
      displaySegments,
      isRecording,
      rememberSpeakerName,
      note.id,
      onLiveSpeakerLock,
      persistDisplaySegments,
      refreshSpeakerNames,
      refreshSpeakerProfiles,
    ]
  );

  const handleConfirmSuggestion = useCallback(
    async (speakerId: string, suggestedName: string, profileId: number) => {
      await handleMapSpeaker(speakerId, suggestedName, null, profileId);
    },
    [handleMapSpeaker]
  );

  const handleAttachSpeakerEmail = useCallback(
    async (profileId: number, email: string | null) => {
      const result = await window.electronAPI?.attachSpeakerEmail?.(profileId, email);
      if (result?.success) {
        refreshSpeakerProfiles();
      }
    },
    [refreshSpeakerProfiles]
  );

  const handleDismissSuggestion = useCallback(
    async (speakerId: string) => {
      const currentSegments = displaySegments.map((s) =>
        s.speaker === speakerId
          ? applyTranscriptSpeakerPatch(s, {
              suggestedName: undefined,
              suggestedProfileId: undefined,
            })
          : s
      );
      await persistDisplaySegments(currentSegments, !!diarizedSegments || !isRecording);
    },
    [displaySegments, diarizedSegments, isRecording, persistDisplaySegments]
  );

  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [selectionNoteId, setSelectionNoteId] = useState(note.id);
  if (selectionNoteId !== note.id) {
    setSelectionNoteId(note.id);
    setSelectedSegmentIds(new Set());
  }

  const handleToggleSelect = useCallback((segmentId: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedSegmentIds(new Set());
  }, []);

  useEffect(() => {
    if (selectedSegmentIds.size === 0) return;
    const visibleIds = new Set(visibleTranscriptSegments.map((segment) => segment.id));
    setSelectedSegmentIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectedSegmentIds.size, visibleTranscriptSegments]);

  useEffect(() => {
    if (selectedSegmentIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSegmentIds.size, handleClearSelection]);

  const handleBulkAssignName = useCallback(
    async (displayName: string, _email?: string | null, profileId?: number) => {
      if (!selectedSegmentIds.size) return;
      await rememberSpeakerName(displayName, _email ?? null);
      const nextSegments = assignSelectedTranscriptSegments(
        displaySegments,
        selectedSegmentIds,
        displayName
      ).map((segment) =>
        selectedSegmentIds.has(segment.id)
          ? { ...segment, suggestedProfileId: profileId ?? segment.suggestedProfileId }
          : segment
      );
      await persistDisplaySegments(nextSegments);
      refreshSpeakerNames();
      handleClearSelection();
    },
    [
      displaySegments,
      selectedSegmentIds,
      persistDisplaySegments,
      rememberSpeakerName,
      refreshSpeakerNames,
      handleClearSelection,
    ]
  );

  const handleAssignSingleSegmentName = useCallback(
    async (segmentId: string, displayName: string, email?: string | null, profileId?: number) => {
      await rememberSpeakerName(displayName, email ?? null);
      const nextSegments = assignSelectedTranscriptSegments(
        displaySegments,
        new Set([segmentId]),
        displayName
      ).map((segment) =>
        segment.id === segmentId
          ? { ...segment, suggestedProfileId: profileId ?? segment.suggestedProfileId }
          : segment
      );
      await persistDisplaySegments(nextSegments);
      refreshSpeakerNames();
    },
    [displaySegments, persistDisplaySegments, refreshSpeakerNames, rememberSpeakerName]
  );

  const handleAssignSpeakerGroupName = useCallback(
    async (
      speakerId: string,
      displayName: string,
      email?: string | null,
      profileId?: number | null
    ) => {
      await rememberSpeakerName(displayName, email ?? null);
      setSpeakerMappings((prev) => ({ ...prev, [speakerId]: displayName }));
      await window.electronAPI?.setSpeakerMapping?.(
        note.id,
        speakerId,
        displayName,
        email,
        profileId
      );
      const nextSegments = assignSpeakerGroupName(displaySegments, speakerId, displayName).map(
        (segment) =>
          segment.speaker === speakerId
            ? { ...segment, suggestedProfileId: profileId ?? segment.suggestedProfileId }
            : segment
      );
      await persistDisplaySegments(nextSegments);
      refreshSpeakerProfiles();
      refreshSpeakerNames();
    },
    [
      displaySegments,
      note.id,
      persistDisplaySegments,
      refreshSpeakerNames,
      refreshSpeakerProfiles,
      rememberSpeakerName,
    ]
  );

  const handleTitleInput = useCallback(() => {
    if (titleRef.current) {
      const text = titleRef.current.textContent || "";
      onTitleChange(text);
    }
  }, [onTitleChange]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editorRef.current?.commands.focus();
    }
  }, []);

  const handleTitlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\n/g, " ");
    document.execCommand("insertText", false, text);
  }, []);

  const prevRecordingRef = useRef(false);
  useEffect(() => {
    if (isRecording && !prevRecordingRef.current) {
      setIsTranscriptEditing(false);
      scheduleUiUpdate(() => setViewMode("transcript"));
    }
    prevRecordingRef.current = isRecording;
  }, [isRecording, scheduleUiUpdate]);

  const handleContentChange = useCallback(
    (newValue: string) => {
      onContentChange(newValue);
    },
    [onContentChange]
  );

  const handleEnhancedChange = useCallback(
    (value: string) => {
      enhancement?.onChange(value);
    },
    [enhancement]
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      const data = await file.arrayBuffer();
      const mimeType =
        file.type || (file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
      const result = await window.electronAPI?.saveNoteImageAsset?.(note.id, {
        name: file.name,
        mimeType,
        data,
      });
      if (!result?.success || !result.asset?.url) {
        toast({
          title: t("notes.editor.imageUploadFailed"),
          description: result?.error,
          variant: "destructive",
        });
        throw new Error(result?.error || "Image upload failed");
      }
      return { src: result.asset.url, alt: file.name || t("notes.editor.imageAlt") };
    },
    [note.id, t, toast]
  );

  const shouldUseImportedTitle = useCallback(
    (title: string | null) => {
      if (!title) return false;
      const current = (note.title || "").trim();
      return (
        !current ||
        current === "Untitled Note" ||
        current === "New note" ||
        current === t("notes.editor.untitled")
      );
    },
    [note.title, t]
  );

  const importTranscriptText = useCallback(
    async (raw: string) => {
      const imported = parseImportedTranscriptTxt(raw);
      if (imported.segments.length === 0) {
        toast({
          title: t("notes.editor.transcriptImportFailed"),
          description: t("notes.editor.transcriptImportNoSegments"),
          variant: "destructive",
        });
        return;
      }

      if (effectiveTranscript) {
        const confirmed = window.confirm(t("notes.editor.transcriptImportOverwriteConfirm"));
        if (!confirmed) return;
      }

      const transcript = serializeTranscriptSegments(imported.segments);
      const updates: { transcript: string; title?: string } = { transcript };
      if (shouldUseImportedTitle(imported.title)) updates.title = imported.title || undefined;

      const result = await window.electronAPI?.updateNote(note.id, updates);
      if (!result?.success) {
        toast({
          title: t("notes.editor.transcriptImportFailed"),
          variant: "destructive",
        });
        return;
      }

      setDiarizedSegments(imported.segments);
      setSelectedSpeakerFilterKeys(null);
      setIsTranscriptEditing(false);
      setEditableTranscriptSegments([]);
      setEditableTranscriptText("");
      setViewMode("transcript");
      toast({
        title: t("notes.editor.transcriptImportSuccess", {
          count: imported.segments.length,
        }),
      });
    },
    [effectiveTranscript, note.id, shouldUseImportedTitle, t, toast]
  );

  const importTranscriptFile = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();
      if (!name.endsWith(".txt") && !name.endsWith(".md") && !name.endsWith(".markdown")) {
        toast({
          title: t("notes.editor.transcriptImportUnsupported"),
          variant: "destructive",
        });
        return;
      }
      await importTranscriptText(await file.text());
    },
    [importTranscriptText, t, toast]
  );

  const importNoteFile = useCallback(
    async (file: File) => {
      const filePath = window.electronAPI?.getPathForFile?.(file);
      if (!filePath) {
        toast({
          title: t("notes.editor.noteImportFailed"),
          description: t("notes.editor.noteImportNoFilePath"),
          variant: "destructive",
        });
        return;
      }

      setIsImportingNote(true);
      try {
        const result = await window.electronAPI?.importNoteFile?.(note.id, filePath);
        if (!result?.success || !result.note) {
          toast({
            title: t("notes.editor.noteImportFailed"),
            description: result?.error,
            variant: "destructive",
          });
          return;
        }

        setViewMode("raw");
        toast({
          title: t("notes.editor.noteImportSuccess", {
            count: result.imported?.imageCount ?? 0,
          }),
        });
      } finally {
        setIsImportingNote(false);
      }
    },
    [note.id, t, toast]
  );

  const handleImportInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      const target = queuedImportTargetRef.current;
      queuedImportTargetRef.current = null;
      setQueuedImportTarget(null);

      if (target === "transcript") {
        await importTranscriptFile(file);
        return;
      }
      if (target === "note") {
        await importNoteFile(file);
        return;
      }

      setPendingImportFile(file);
    },
    [importNoteFile, importTranscriptFile]
  );

  const openImportFilePicker = useCallback(
    (target: ImportTarget) => {
      if (target === "transcript" && !canImportTranscriptFile) return;
      if (target === "note" && !canImportNoteFile) return;
      queuedImportTargetRef.current = target;
      setQueuedImportTarget(target);
      window.requestAnimationFrame(() => importInputRef.current?.click());
    },
    [canImportNoteFile, canImportTranscriptFile]
  );

  const handleChooseImportTarget = useCallback(
    async (target: ImportTarget) => {
      if (!pendingImportFile) return;
      if (target === "transcript" && !canImportTranscriptFile) return;
      if (target === "note" && !canImportNoteFile) return;
      if (target === "transcript") {
        await importTranscriptFile(pendingImportFile);
      } else {
        await importNoteFile(pendingImportFile);
      }
      setPendingImportFile(null);
    },
    [
      canImportNoteFile,
      canImportTranscriptFile,
      importNoteFile,
      importTranscriptFile,
      pendingImportFile,
    ]
  );

  const handleNoteDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canImportNoteFile) return;
      const hasFile = Array.from(event.dataTransfer.items || []).some(
        (item) => item.kind === "file"
      );
      if (!hasFile) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canImportNoteFile]
  );

  const handleNoteDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canImportNoteFile) return;
      const file = Array.from(event.dataTransfer.files || [])[0];
      if (!file) return;
      event.preventDefault();
      setPendingImportFile(file);
    },
    [canImportNoteFile]
  );

  const handleStartTranscriptEdit = useCallback(() => {
    if (!canEditTranscript) return;
    setViewMode("transcript");
    setEditableTranscriptSegments(displaySegments.map((segment) => ({ ...segment })));
    setEditableTranscriptText(effectiveTranscript);
    setFindText("");
    setReplaceText("");
    setIgnoreCase(true);
    setSelectedSegmentIds(new Set());
    setIsTranscriptEditing(true);
  }, [canEditTranscript, displaySegments, effectiveTranscript]);

  const handleCancelTranscriptEdit = useCallback(() => {
    setIsTranscriptEditing(false);
    setEditableTranscriptSegments([]);
    setEditableTranscriptText("");
    setFindText("");
    setReplaceText("");
  }, []);

  const reportTranscriptReplacementCorrection = useCallback(
    (replacementCount: number) => {
      if (replacementCount <= 0) return;
      window.electronAPI?.learnReplacementCorrection?.({
        findText,
        replacementText: replaceText,
        replacementCount,
        source: "transcript-edit-find-replace",
      });
    },
    [findText, replaceText]
  );

  const handleReplaceCurrentTranscriptMatch = useCallback(() => {
    if (!findText || transcriptMatchCount === 0 || activeFindIndex < 0) return;
    if (transcriptIsStructured) {
      setEditableTranscriptSegments((segments) => {
        let remainingIndex = activeFindIndex;
        return segments.map((segment) => {
          const segmentMatchCount = countMatches(segment.text, findText, { ignoreCase });
          if (remainingIndex >= segmentMatchCount) {
            remainingIndex -= segmentMatchCount;
            return segment;
          }
          if (remainingIndex < 0) return segment;
          const nextSegment = {
            ...segment,
            text: replaceFindMatchAt(segment.text, findText, replaceText, remainingIndex, {
              ignoreCase,
            }),
          };
          remainingIndex = -1;
          return nextSegment;
        });
      });
      reportTranscriptReplacementCorrection(1);
      return;
    }
    setEditableTranscriptText((text) =>
      replaceFindMatchAt(text, findText, replaceText, activeFindIndex, { ignoreCase })
    );
    reportTranscriptReplacementCorrection(1);
  }, [
    activeFindIndex,
    findText,
    ignoreCase,
    replaceText,
    reportTranscriptReplacementCorrection,
    transcriptIsStructured,
    transcriptMatchCount,
  ]);

  const handleReplaceAllTranscriptMatches = useCallback(() => {
    if (!findText || transcriptMatchCount === 0) return;
    const replacementCount = transcriptMatchCount;
    if (transcriptIsStructured) {
      setEditableTranscriptSegments((segments) =>
        segments.map((segment) => ({
          ...segment,
          text: replaceAllFindMatches(segment.text, findText, replaceText, { ignoreCase }),
        }))
      );
      setActiveFindIndex(-1);
      reportTranscriptReplacementCorrection(replacementCount);
      return;
    }
    setEditableTranscriptText((text) =>
      replaceAllFindMatches(text, findText, replaceText, { ignoreCase })
    );
    setActiveFindIndex(-1);
    reportTranscriptReplacementCorrection(replacementCount);
  }, [
    findText,
    ignoreCase,
    replaceText,
    reportTranscriptReplacementCorrection,
    transcriptIsStructured,
    transcriptMatchCount,
  ]);

  const handleFindMatchCountChange = useCallback(
    (count: number) => {
      if (viewMode !== "transcript") setFindMatchCount(count);
    },
    [viewMode]
  );

  const handleTranscriptFindMatchCountChange = useCallback(
    (count: number) => {
      if (viewMode === "transcript") setFindMatchCount(count);
    },
    [viewMode]
  );

  const handleNavigateFind = useCallback(
    (direction: 1 | -1) => {
      setActiveFindIndex((current) => getNextFindIndex(current, findMatchCount, direction));
    },
    [findMatchCount]
  );

  const queueRichTextReplace = useCallback(
    (mode: "current" | "all") => {
      if (!findText || findMatchCount === 0) return;
      if (mode === "current" && activeFindIndex < 0) return;
      replaceRequestIdRef.current += 1;
      setRichTextReplaceRequest({
        id: replaceRequestIdRef.current,
        mode,
        query: findText,
        replacement: replaceText,
        activeIndex: activeFindIndex,
        ignoreCase,
      });
      if (mode === "all") setActiveFindIndex(-1);
    },
    [activeFindIndex, findMatchCount, findText, ignoreCase, replaceText]
  );

  const handleReplaceCurrentMatch = useCallback(() => {
    if (viewMode === "transcript" && isTranscriptEditing) {
      handleReplaceCurrentTranscriptMatch();
      return;
    }
    queueRichTextReplace("current");
  }, [handleReplaceCurrentTranscriptMatch, isTranscriptEditing, queueRichTextReplace, viewMode]);

  const handleReplaceAllMatches = useCallback(() => {
    if (viewMode === "transcript" && isTranscriptEditing) {
      handleReplaceAllTranscriptMatches();
      return;
    }
    queueRichTextReplace("all");
  }, [handleReplaceAllTranscriptMatches, isTranscriptEditing, queueRichTextReplace, viewMode]);

  const handleRichTextReplaceComplete = useCallback((result: { id: number; replaced: number }) => {
    setRichTextReplaceRequest((request) => (request?.id === result.id ? null : request));
  }, []);

  const handleFindKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleNavigateFind(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setIsFindOpen(false);
      }
    },
    [handleNavigateFind]
  );

  const handleSaveTranscriptEdit = useCallback(async () => {
    if (!isTranscriptEditing) return;
    const transcript = transcriptIsStructured
      ? serializeTranscriptSegments(editableTranscriptSegments)
      : editableTranscriptText;
    setIsTranscriptSaving(true);
    try {
      await window.electronAPI?.updateNote(note.id, { transcript });
      if (transcriptIsStructured) {
        setDiarizedSegments(editableTranscriptSegments);
      }
      setIsTranscriptEditing(false);
      setEditableTranscriptSegments([]);
      setEditableTranscriptText("");
      setFindText("");
      setReplaceText("");
    } finally {
      setIsTranscriptSaving(false);
    }
  }, [
    editableTranscriptSegments,
    editableTranscriptText,
    isTranscriptEditing,
    note.id,
    transcriptIsStructured,
  ]);

  const handleAskSubmit = useCallback(
    (text: string) => {
      if (chatMode === "hidden") {
        setChatMode("floating");
      }
      embeddedChat.sendMessage(text);
    },
    [chatMode, embeddedChat]
  );
  const handleAskInputFocus = useCallback(() => {
    if (chatMode === "hidden") {
      setChatMode("floating");
    }
  }, [chatMode]);

  const recordedDateSource = note.recorded_at || note.created_at;
  const noteDate = formatNoteDate(recordedDateSource);
  const shortDate = formatShortDate(recordedDateSource);
  const openRecordedDateEditor = useCallback(() => {
    setRecordedDateInput(formatDateTimeLocalValue(recordedDateSource));
    setIsRecordedDateOpen(true);
  }, [recordedDateSource]);
  const handleSaveRecordedDate = useCallback(async () => {
    const nextRecordedAt = parseDateTimeLocalValue(recordedDateInput);
    if (!nextRecordedAt) {
      toast({
        title: t("notes.editor.recordedDateInvalid"),
        variant: "destructive",
      });
      return;
    }
    try {
      setIsSavingRecordedDate(true);
      await onRecordedAtChange?.(note.id, nextRecordedAt);
      setIsRecordedDateOpen(false);
    } catch (err) {
      toast({
        title: t("notes.editor.recordedDateSaveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSavingRecordedDate(false);
    }
  }, [note.id, onRecordedAtChange, recordedDateInput, t, toast]);
  const showFindBar = isFindOpen || (isTranscriptEditing && viewMode === "transcript");
  const showReplaceControls =
    (viewMode === "raw" && actionProcessingState !== "processing") ||
    (viewMode === "enhanced" && !!enhancement) ||
    (viewMode === "transcript" && isTranscriptEditing);
  const findStatusText = findText
    ? t("notes.editor.findMatchPosition", {
        current: activeFindIndex >= 0 ? activeFindIndex + 1 : 0,
        count: findMatchCount,
      })
    : t("notes.editor.transcriptNoSearch");

  return (
    <div
      className="flex h-full min-w-0 min-h-0 overflow-hidden"
      onDragOver={handleNoteDragOver}
      onDrop={handleNoteDrop}
    >
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="min-w-0 px-5 pt-4 pb-3">
          <div
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleTitleInput}
            onKeyDown={handleTitleKeyDown}
            onPaste={handleTitlePaste}
            data-placeholder={t("notes.editor.untitled")}
            className="min-h-9 max-w-full -mx-2 rounded-lg border border-transparent px-2 py-1 text-lg font-semibold leading-7 text-foreground bg-transparent outline-none tracking-[-0.01em] transition-colors empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none hover:border-border/70 hover:bg-background/75 focus:border-ring/45 focus:bg-background focus:shadow-sm"
            role="textbox"
            aria-label={t("notes.editor.noteTitle")}
          />
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {shortDate && (
              <Popover open={isRecordedDateOpen} onOpenChange={setIsRecordedDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-background/75 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground"
                    title={t("notes.editor.recordedDateTitle", { date: noteDate })}
                    aria-label={t("notes.editor.editRecordedDate")}
                    onClick={openRecordedDateEditor}
                  >
                    <Calendar size={11} className="shrink-0" />
                    {shortDate}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" sideOffset={6} className="w-64 p-3">
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("notes.editor.recordedDate")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("notes.editor.recordedDateDescription")}
                      </p>
                    </div>
                    <input
                      type="datetime-local"
                      value={recordedDateInput}
                      onChange={(event) => setRecordedDateInput(event.target.value)}
                      className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring/50"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsRecordedDateOpen(false)}
                        className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveRecordedDate}
                        disabled={isSavingRecordedDate}
                        className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        {isSavingRecordedDate ? t("common.saving") : t("common.save")}
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {calendarEventName && (
              <span className="inline-flex h-6 min-w-0 max-w-44 items-center gap-1.5 rounded-md border border-border/70 bg-background/75 px-2 text-[11px] font-medium text-muted-foreground">
                <LinkIcon size={11} className="shrink-0" />
                <span className="truncate">{calendarEventName}</span>
              </span>
            )}
            <NoteParticipants noteId={note.id} participants={parsedParticipants} />
            {folders && onMoveToFolder && (
              <DropdownMenu
                onOpenChange={(open) => {
                  if (!open) {
                    setFolderSearch("");
                    setIsCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex h-6 max-w-44 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-background/75 px-2 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-border hover:bg-muted/70 hover:text-foreground cursor-pointer outline-none">
                    <FolderOpen size={11} className="shrink-0" />
                    <span className="truncate">{folderName || t("notes.editor.noFolder")}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={6} className="min-w-44 p-1">
                  {folders.length > 5 && (
                    <>
                      <div className="relative px-1.5 py-0.5">
                        <Search
                          size={9}
                          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/15 pointer-events-none"
                        />
                        <input
                          value={folderSearch}
                          onChange={(e) => setFolderSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder={t("notes.context.searchFolders")}
                          className="input-inline w-full pl-4.5 pr-1 py-0.5 text-xs text-foreground placeholder:text-foreground/15 outline-none border-none appearance-none"
                        />
                      </div>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <div className="overflow-y-auto max-h-48">
                    {filteredFolders.map((folder) => {
                      const isCurrent = folder.id === note.folder_id;
                      return (
                        <DropdownMenuItem
                          key={folder.id}
                          disabled={isCurrent}
                          onClick={() => onMoveToFolder(note.id, folder.id)}
                          className="text-xs gap-2 rounded-md px-2 py-1.5"
                        >
                          <FolderOpen size={11} className="text-foreground/30 shrink-0" />
                          <span className="truncate flex-1">{folder.name}</span>
                          {isCurrent && <Check size={9} className="text-foreground/65 shrink-0" />}
                        </DropdownMenuItem>
                      );
                    })}
                    {folderSearch && filteredFolders.length === 0 && (
                      <p className="text-xs text-foreground/20 text-center py-1.5">
                        {t("notes.context.noResults")}
                      </p>
                    )}
                  </div>
                  {onCreateFolderAndMove && (
                    <>
                      <DropdownMenuSeparator />
                      {isCreatingFolder ? (
                        <div className="px-1">
                          <input
                            autoFocus
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter" && newFolderName.trim()) {
                                onCreateFolderAndMove(note.id, newFolderName.trim());
                                setNewFolderName("");
                                setIsCreatingFolder(false);
                              }
                              if (e.key === "Escape") {
                                setIsCreatingFolder(false);
                                setNewFolderName("");
                              }
                            }}
                            placeholder={t("notes.folders.folderName")}
                            className="input-inline w-full px-2 py-1.5 rounded-md bg-transparent text-xs text-foreground placeholder:text-foreground/20 outline-none border-none appearance-none"
                          />
                        </div>
                      ) : (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setIsCreatingFolder(true);
                          }}
                          className="text-xs gap-2 rounded-md px-2 py-1.5 text-foreground/40"
                        >
                          <Plus size={10} />
                          {t("notes.context.newFolder")}
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isSaving && (
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                <Loader2 size={8} className="animate-spin" />
                {t("notes.editor.saving")}
              </span>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-1 pl-1">
              <div className="ow-segmented flex shrink-0 items-center gap-0.5 shadow-none">
                <div
                  className={cn(
                    "flex h-6 shrink-0 items-center rounded-md",
                    viewMode === "transcript" && "bg-background shadow-sm"
                  )}
                >
                  <button
                    data-segment-button
                    data-segment-value="transcript"
                    onClick={() => setViewMode("transcript")}
                    className={cn(
                      "ow-segmented-item h-6 shrink-0 whitespace-nowrap rounded-r-none px-2 py-0 text-[11px]",
                      viewMode === "transcript" && "bg-transparent text-foreground shadow-none"
                    )}
                  >
                    <MessageSquareText size={10} />
                    {t("notes.editor.transcript")}
                  </button>
                  {hasTranscriptEditControls && !isTranscriptEditing && (
                    <button
                      type="button"
                      onClick={handleStartTranscriptEdit}
                      disabled={!canEditTranscript}
                      className={cn(
                        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-l transition-colors",
                        viewMode === "transcript"
                          ? "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                          : "border-transparent text-muted-foreground/70 hover:bg-background/80 hover:text-foreground",
                        "disabled:cursor-not-allowed disabled:opacity-40"
                      )}
                      aria-label={t("notes.editor.transcriptEdit")}
                      title={
                        isRecording
                          ? t("notes.editor.transcriptEditDisabledRecording")
                          : t("notes.editor.transcriptEdit")
                      }
                    >
                      <Pencil size={10} />
                    </button>
                  )}
                </div>
                <button
                  data-segment-button
                  data-segment-value="raw"
                  onClick={() => {
                    if (!isTranscriptEditing) setViewMode("raw");
                  }}
                  className={cn(
                    "ow-segmented-item h-6 shrink-0 whitespace-nowrap px-2 py-0 text-[11px]",
                    viewMode === "raw" && "ow-segmented-item-active",
                    isTranscriptEditing && viewMode !== "raw" && "cursor-not-allowed opacity-40"
                  )}
                >
                  <AlignLeft size={10} />
                  {t("notes.editor.notes")}
                </button>
                {enhancement && (
                  <button
                    data-segment-button
                    data-segment-value="enhanced"
                    onClick={() => {
                      if (!isTranscriptEditing) setViewMode("enhanced");
                    }}
                    className={cn(
                      "ow-segmented-item h-6 shrink-0 whitespace-nowrap px-2 py-0 text-[11px]",
                      viewMode === "enhanced" && "ow-segmented-item-active",
                      isTranscriptEditing &&
                        viewMode !== "enhanced" &&
                        "cursor-not-allowed opacity-40"
                    )}
                  >
                    <Sparkles size={9} />
                    {t("notes.editor.enhanced")}
                    {enhancement.isStale && (
                      <span
                        className="w-1 h-1 rounded-full bg-amber-400/60"
                        title={t("notes.editor.staleIndicator")}
                      />
                    )}
                  </button>
                )}
              </div>
              <input
                ref={importInputRef}
                type="file"
                accept={
                  queuedImportTarget === "transcript"
                    ? ".txt,.md,.markdown,text/plain,text/markdown"
                    : ".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                }
                className="hidden"
                onChange={handleImportInput}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!canImportNoteFile}
                    className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md bg-foreground/4 dark:bg-white/5 text-foreground/45 dark:text-foreground/35 hover:text-foreground/70 hover:bg-foreground/8 dark:hover:bg-white/8 disabled:opacity-40 disabled:pointer-events-none transition-colors duration-150"
                    aria-label={t("notes.editor.importFile")}
                    title={t("notes.editor.importFile")}
                  >
                    <FileUp size={11} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={4}>
                  <DropdownMenuItem
                    onClick={() => openImportFilePicker("transcript")}
                    disabled={!canImportTranscriptFile}
                    className="text-xs gap-2"
                  >
                    <MessageSquareText size={13} className="text-foreground/40" />
                    {t("notes.editor.importToTranscript")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openImportFilePicker("note")}
                    className="text-xs gap-2"
                  >
                    <AlignLeft size={13} className="text-foreground/40" />
                    {t("notes.editor.importToNote")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {hasTranscriptEditControls && isTranscriptEditing && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSaveTranscriptEdit}
                    disabled={isTranscriptSaving}
                    className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md bg-foreground/6 dark:bg-white/6 text-foreground/60 dark:text-foreground/50 hover:text-foreground/80 hover:bg-foreground/10 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none transition-colors duration-150"
                    aria-label={t("notes.editor.transcriptSave")}
                    title={t("notes.editor.transcriptSave")}
                  >
                    {isTranscriptSaving ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Check size={10} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelTranscriptEdit}
                    disabled={isTranscriptSaving}
                    className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md bg-foreground/4 dark:bg-white/5 text-foreground/45 dark:text-foreground/35 hover:text-foreground/70 hover:bg-foreground/8 dark:hover:bg-white/8 disabled:opacity-40 disabled:pointer-events-none transition-colors duration-150"
                    aria-label={t("notes.editor.transcriptCancel")}
                    title={t("notes.editor.transcriptCancel")}
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
              {viewMode === "transcript" &&
                !isTranscriptEditing &&
                !isRecording &&
                speakerFilterOptions.length > 1 && (
                  <TranscriptSpeakerFilter
                    options={speakerFilterOptions}
                    selectedKeys={selectedSpeakerFilterKeys}
                    onChange={setSelectedSpeakerFilterKeys}
                    t={t}
                  />
                )}
              {SHARING_ENABLED && note.cloud_id && (
                <button
                  type="button"
                  onClick={() => setShareDialogOpen(true)}
                  className={cn(
                    "shrink-0 h-6 w-6 flex items-center justify-center rounded-md",
                    "bg-foreground/4 dark:bg-white/5",
                    "hover:bg-foreground/8 dark:hover:bg-white/10",
                    "active:bg-foreground/12 dark:active:bg-white/15",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "transition-colors duration-150"
                  )}
                  aria-label={t("noteEditor.share.button")}
                >
                  <Share2
                    size={11}
                    className={cn(
                      "transition-colors",
                      isShared
                        ? "text-foreground/70 dark:text-white/70"
                        : "text-foreground/50 dark:text-foreground/40"
                    )}
                  />
                </button>
              )}
              {(onExportNote || onExportTranscript || onDownloadOriginalAudio) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md bg-foreground/4 dark:bg-white/5 text-foreground/50 dark:text-foreground/40 hover:text-foreground/70 hover:bg-foreground/8 dark:hover:text-foreground/60 dark:hover:bg-white/8 transition-colors duration-150"
                      aria-label={t("notes.editor.export")}
                    >
                      <Download size={11} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    {viewMode === "transcript" && onExportTranscript ? (
                      <>
                        <DropdownMenuItem
                          onClick={() => onExportTranscript("txt")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asTranscriptText")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onExportTranscript("srt")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asSubtitles")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onExportTranscript("md")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asTranscriptMarkdown")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onExportTranscript("json")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asJson")}
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <>
                        <DropdownMenuItem
                          onClick={() => onExportNote?.("md")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asMarkdown")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onExportNote?.("txt")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asPlainText")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onExportNote?.("pdf")}
                          className="text-xs gap-2"
                        >
                          <FileText size={13} className="text-foreground/40" />
                          {t("notes.editor.asPdf")}
                        </DropdownMenuItem>
                      </>
                    )}
                    {onDownloadOriginalAudio && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDownloadOriginalAudio()}
                          disabled={!hasDownloadableAudio}
                          className="text-xs gap-2"
                        >
                          <FileAudio size={13} className="text-foreground/40" />
                          {isRecording
                            ? t("notes.editor.downloadSavedAudio")
                            : t("notes.editor.downloadOriginalAudio")}
                        </DropdownMenuItem>
                      </>
                    )}
                    {onShowOriginalAudioInFolder && (
                      <DropdownMenuItem
                        onClick={() => onShowOriginalAudioInFolder()}
                        disabled={!hasDownloadableAudio}
                        className="text-xs gap-2"
                      >
                        <FolderOpen size={13} className="text-foreground/40" />
                        {t("notes.editor.showAudioInFolder")}
                      </DropdownMenuItem>
                    )}
                    {onManageSavedAudio && (
                      <DropdownMenuItem
                        onClick={() => onManageSavedAudio()}
                        disabled={!hasDownloadableAudio}
                        className="text-xs gap-2"
                      >
                        <FileAudio size={13} className="text-foreground/40" />
                        {t("notes.editor.manageSavedAudio")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 relative min-w-0 min-h-0 flex flex-col overflow-hidden">
          {showFindBar && (
            <div className="shrink-0 border-b border-border/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border/30 bg-background/80 px-2 py-1">
                  <Search size={12} className="text-foreground/35" />
                  <input
                    ref={findInputRef}
                    value={findText}
                    onChange={(event) => setFindText(event.target.value)}
                    onKeyDown={handleFindKeyDown}
                    placeholder={t("notes.editor.findPlaceholder")}
                    className="w-32 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground/25"
                  />
                </div>
                {showReplaceControls && (
                  <input
                    value={replaceText}
                    onChange={(event) => setReplaceText(event.target.value)}
                    placeholder={t("notes.editor.transcriptReplaceWith")}
                    className="h-7 w-32 rounded-md border border-border/30 bg-background/80 px-2 text-xs text-foreground outline-none placeholder:text-foreground/25 focus-visible:ring-1 focus-visible:ring-ring/60"
                  />
                )}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleNavigateFind(-1)}
                    disabled={!findText || findMatchCount === 0}
                    aria-label={t("notes.editor.findPrevious")}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-foreground/5 text-foreground/55 transition-colors hover:bg-foreground/9 hover:text-foreground/75 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateFind(1)}
                    disabled={!findText || findMatchCount === 0}
                    aria-label={t("notes.editor.findNext")}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-foreground/5 text-foreground/55 transition-colors hover:bg-foreground/9 hover:text-foreground/75 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
                {showReplaceControls && (
                  <label className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-foreground/55">
                    <input
                      type="checkbox"
                      checked={ignoreCase}
                      onChange={(event) => setIgnoreCase(event.target.checked)}
                      className="h-3 w-3 accent-primary"
                    />
                    {t("notes.editor.transcriptIgnoreCase")}
                  </label>
                )}
                <span className="text-[11px] tabular-nums text-foreground/35">
                  {findStatusText}
                </span>
                {showReplaceControls && (
                  <button
                    type="button"
                    onClick={handleReplaceCurrentMatch}
                    disabled={!findText || findMatchCount === 0 || activeFindIndex < 0}
                    className="h-7 rounded-md bg-foreground/5 px-2 text-[11px] font-medium text-foreground/55 transition-colors hover:bg-foreground/9 hover:text-foreground/75 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    {t("notes.editor.replaceCurrent")}
                  </button>
                )}
                {showReplaceControls && (
                  <button
                    type="button"
                    onClick={handleReplaceAllMatches}
                    disabled={!findText || findMatchCount === 0}
                    className="h-7 rounded-md bg-foreground/5 px-2 text-[11px] font-medium text-foreground/55 transition-colors hover:bg-foreground/9 hover:text-foreground/75 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    {t("notes.editor.transcriptReplaceAll")}
                  </button>
                )}
                {isFindOpen && (
                  <button
                    type="button"
                    onClick={() => setIsFindOpen(false)}
                    aria-label={t("notes.editor.findClose")}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/6 hover:text-foreground/70"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0 min-h-0 overflow-x-hidden overflow-y-auto">
            {viewMode === "transcript" && (hasChatSegments || isRecording) ? (
              <MeetingTranscriptChat
                segments={visibleTranscriptSegments}
                isEditing={isTranscriptEditing}
                onSegmentsChange={setEditableTranscriptSegments}
                searchTerm={findText}
                ignoreCase={ignoreCase}
                activeSearchIndex={activeFindIndex}
                onSearchMatchCountChange={handleTranscriptFindMatchCountChange}
                micPartial={isRecording ? meetingMicPartial : undefined}
                systemPartial={isRecording ? meetingSystemPartial : undefined}
                systemPartialSpeakerId={isRecording ? meetingSystemPartialSpeakerId : undefined}
                systemPartialSpeakerName={isRecording ? meetingSystemPartialSpeakerName : undefined}
                speakerMappings={speakerMappings}
                speakerProfiles={knownSpeakers}
                participants={parsedParticipants}
                isRecording={isRecording}
                isDiarizing={isDiarizing}
                sessionDiarizationEnabled={sessionDiarizationEnabled}
                sessionExpectedCount={sessionExpectedCount}
                userTouchedStepper={userTouchedStepper}
                onSetSessionDiarizationEnabled={onSetSessionDiarizationEnabled}
                onSetSessionExpectedCount={onSetSessionExpectedCount}
                onMapSpeaker={isRecording ? handleMapSpeaker : handleAssignSpeakerGroupName}
                onMapSegmentSpeaker={isRecording ? undefined : handleAssignSingleSegmentName}
                onConfirmSuggestion={handleConfirmSuggestion}
                onDismissSuggestion={handleDismissSuggestion}
                onAttachSpeakerEmail={handleAttachSpeakerEmail}
                selectedSegmentIds={
                  !isRecording && !isTranscriptEditing ? selectedSegmentIds : undefined
                }
                recordingStartedAt={recordingStartedAt}
                onToggleSelect={
                  !isRecording && !isTranscriptEditing ? handleToggleSelect : undefined
                }
                emptyMessage={t("notes.speaker.filterEmpty")}
              />
            ) : viewMode === "transcript" && hasMeetingTranscript ? (
              isTranscriptEditing ? (
                <textarea
                  ref={plainTranscriptTextareaRef}
                  value={editableTranscriptText}
                  onChange={(event) => setEditableTranscriptText(event.target.value)}
                  className="mx-5 mt-5 mb-24 h-[calc(100%-7rem)] w-[calc(100%-2.5rem)] resize-none rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm leading-relaxed text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-ring/50 focus:ring-2 focus:ring-ring/10"
                />
              ) : (
                <RichTextEditor
                  value={effectiveTranscript}
                  disabled
                  className="mx-5 mt-5 mb-24 h-[calc(100%-7rem)] w-[calc(100%-2.5rem)] rounded-xl border border-slate-200 bg-white shadow-sm"
                  findQuery={findText}
                  findActiveIndex={activeFindIndex}
                  findIgnoreCase={ignoreCase}
                  onFindMatchCountChange={handleTranscriptFindMatchCountChange}
                />
              )
            ) : viewMode === "transcript" ? (
              <div className="mx-5 mt-5 mb-24 flex h-[calc(100%-7rem)] w-[calc(100%-2.5rem)] flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/70 px-6 text-center">
                <MessageSquareText size={22} className="mb-3 text-foreground/30" />
                <p className="text-sm font-medium text-foreground/70">
                  {t("notes.editor.transcriptEmptyTitle")}
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {t("notes.editor.transcriptEmptyDescription")}
                </p>
                <button
                  type="button"
                  onClick={() => openImportFilePicker("transcript")}
                  disabled={!canImportTranscriptFile}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <FileUp size={13} />
                  {t("notes.editor.importFile")}
                </button>
              </div>
            ) : viewMode === "enhanced" && enhancement ? (
              <RichTextEditor
                value={enhancement.content}
                onChange={handleEnhancedChange}
                onImageUpload={handleImageUpload}
                className="mx-5 mt-5 mb-24 h-[calc(100%-7rem)] w-[calc(100%-2.5rem)] rounded-xl border border-slate-200 bg-white shadow-sm"
                findQuery={findText}
                findActiveIndex={activeFindIndex}
                findIgnoreCase={ignoreCase}
                onFindMatchCountChange={handleFindMatchCountChange}
                replaceRequest={viewMode === "enhanced" ? richTextReplaceRequest : null}
                onReplaceRequestComplete={handleRichTextReplaceComplete}
              />
            ) : (
              <RichTextEditor
                value={note.content}
                onChange={handleContentChange}
                onImageUpload={handleImageUpload}
                editorRef={editorRef}
                placeholder={t("notes.editor.startWriting")}
                disabled={actionProcessingState === "processing"}
                className="mx-5 mt-5 mb-24 h-[calc(100%-7rem)] w-[calc(100%-2.5rem)] rounded-xl border border-slate-200 bg-white shadow-sm transition-colors focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/10"
                findQuery={findText}
                findActiveIndex={activeFindIndex}
                findIgnoreCase={ignoreCase}
                onFindMatchCountChange={handleFindMatchCountChange}
                replaceRequest={viewMode === "raw" ? richTextReplaceRequest : null}
                onReplaceRequestComplete={handleRichTextReplaceComplete}
              />
            )}
          </div>
          <ActionProcessingOverlay
            state={actionProcessingState ?? "idle"}
            actionName={actionName ?? null}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none"
            style={{
              background: "linear-gradient(to bottom, transparent, var(--color-background))",
            }}
          />
          {!isRecording && selectedSegmentIds.size > 0 && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
              <SelectionBar
                count={selectedSegmentIds.size}
                onClear={handleClearSelection}
                speakerProfiles={knownSpeakers}
                participants={parsedParticipants}
                onAssignName={handleBulkAssignName}
                t={t}
              />
            </div>
          )}
          <NoteBottomBar
            isRecording={isRecording}
            isProcessing={isProcessing}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            onAskSubmit={handleAskSubmit}
            onInputFocus={handleAskInputFocus}
            actionPicker={isRecording ? undefined : actionPicker}
            hideInput={chatMode !== "hidden"}
            recordingStartedAt={recordingStartedAt}
          />
          {chatMode === "floating" && (
            <EmbeddedChat
              mode="floating"
              onModeChange={setChatMode}
              messages={embeddedChat.messages}
              agentState={embeddedChat.agentState}
              onTextSubmit={embeddedChat.sendMessage}
              onCancel={embeddedChat.cancelStream}
              noteConversations={embeddedChat.noteConversations}
              activeConversationId={embeddedChat.activeConversationId}
              actions={embeddedChat.actions}
              onSwitchConversation={embeddedChat.switchConversation}
              onNewChat={embeddedChat.startNewChat}
              onRequestRunAction={embeddedChat.requestRunNoteAction}
              onConfirmToolCall={embeddedChat.confirmToolCall}
              onCancelToolCall={embeddedChat.cancelToolCall}
              onWriteAssistantMessage={embeddedChat.writeAssistantMessage}
            />
          )}
        </div>
      </div>
      {chatMode === "sidebar" && (
        <EmbeddedChat
          mode="sidebar"
          onModeChange={setChatMode}
          messages={embeddedChat.messages}
          agentState={embeddedChat.agentState}
          onTextSubmit={embeddedChat.sendMessage}
          onCancel={embeddedChat.cancelStream}
          noteConversations={embeddedChat.noteConversations}
          activeConversationId={embeddedChat.activeConversationId}
          actions={embeddedChat.actions}
          onSwitchConversation={embeddedChat.switchConversation}
          onNewChat={embeddedChat.startNewChat}
          onRequestRunAction={embeddedChat.requestRunNoteAction}
          onConfirmToolCall={embeddedChat.confirmToolCall}
          onCancelToolCall={embeddedChat.cancelToolCall}
          onWriteAssistantMessage={embeddedChat.writeAssistantMessage}
        />
      )}
      <Dialog
        open={!!pendingImportFile}
        onOpenChange={(open) => {
          if (!open && !isImportingNote) setPendingImportFile(null);
        }}
      >
        <DialogContent className="sm:max-w-105 p-6 gap-5">
          <DialogHeader>
            <DialogTitle>{t("notes.editor.importTargetTitle")}</DialogTitle>
            <DialogDescription>
              {t("notes.editor.importTargetDescription", {
                file: pendingImportFile?.name || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => void handleChooseImportTarget("transcript")}
              disabled={isImportingNote || !canImportTranscriptFile}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
            >
              <MessageSquareText size={18} className="text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {t("notes.editor.importToTranscript")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("notes.editor.importToTranscriptDescription")}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleChooseImportTarget("note")}
              disabled={isImportingNote || !canImportNoteFile}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
            >
              <AlignLeft size={18} className="text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {t("notes.editor.importToNote")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("notes.editor.importToNoteDescription")}
                </span>
              </span>
            </button>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingImportFile(null)}
              disabled={isImportingNote}
            >
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {SHARING_ENABLED && note.cloud_id && (
        <ShareNoteDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen} note={note} />
      )}
    </div>
  );
}
