import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  ArrowDownUp,
  Loader2,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  SquarePen,
  Search,
  Sparkles,
  ExternalLink,
  FileAudio,
  Download,
  X,
  SquareCheckBig,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  RefreshCw,
  Tag,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { useDialogs } from "../../hooks/useDialogs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectSeparator,
} from "../ui/select";
import { Input } from "../ui/input";
import { useToast } from "../ui/useToast";
import NoteListItem from "./NoteListItem";
import NoteEditor, { type RediarizeAudioOptions } from "./NoteEditor";
import ActionPicker from "./ActionPicker";
import ActionManagerDialog from "./ActionManagerDialog";
import AddNotesToFolderDialog from "./AddNotesToFolderDialog";
import { useActionProcessing } from "../../hooks/useActionProcessing";
import {
  useSettingsStore,
  selectIsCloudNoteFormattingMode,
  selectResolvedNoteFormatting,
} from "../../stores/settingsStore";
import { useFolderManagement } from "../../hooks/useFolderManagement";
import { useFolderReorderDrag } from "../../hooks/useFolderReorderDrag";
import { useNoteDragAndDrop } from "../../hooks/useNoteDragAndDrop";
import { cn } from "../lib/utils";
import { MEETINGS_FOLDER_NAME, findDefaultFolder } from "./shared";
import logger from "../../utils/logger";
import { normalizeDbDate } from "../../utils/dateFormatting";
import { parseTranscriptSegments } from "../../utils/parseTranscriptSegments";
import { buildNoteActionInput, makeActionContentHash } from "./noteActionInput";
import { getAudioBulkAction, getAudioBulkAvailability } from "./audioManagement";
import { deleteNoteAndRefresh } from "./deleteNoteFlow";
import { serializeTranscriptSegments } from "../../utils/transcriptSpeakerState";
import {
  offsetAppendedTranscriptSegments,
  resolveNoteActionTranscript,
} from "../../utils/meetingTranscriptTimeline";
import {
  useNotes,
  useActiveNoteId,
  useActiveFolderId,
  initializeNotes,
  setActiveNoteId,
  setActiveFolderId,
  removeNote,
  updateNoteInStore,
} from "../../stores/noteStore";
import {
  useMeetingRecordingStore,
  useIsMeetingMode,
  useIsNarrowWindow,
  startRecording as storeStartRecording,
  stopRecording as storeStopRecording,
  lockSpeaker,
} from "../../stores/meetingRecordingStore";
import { useNotesOnboarding } from "../../hooks/useNotesOnboarding";
import NotesOnboarding from "./NotesOnboarding";
import type {
  DiarizationTaskStatus,
  MeetingAecMode,
  MeetingAecReason,
  NoteAudioFile,
  NoteExportField,
  NoteExportFormat,
  NoteSortBy,
  SingleNoteExportOptions,
} from "../../types/electron";

const FOLDER_INPUT_CLASS =
  "w-full h-7 bg-background dark:bg-white/[0.03] rounded-md px-2 text-xs text-foreground outline-none border border-border/70 focus:border-border-hover";
const NOTE_SORT_STORAGE_KEY = "noteSortBy";
const NOTES_SIDEBAR_WIDTH_KEY = "superting.notesSidebarWidth";
const NOTES_SIDEBAR_DEFAULT_WIDTH = 224;
const NOTES_SIDEBAR_MIN_WIDTH = 200;
const NOTES_SIDEBAR_MAX_WIDTH = 420;

const clampNotesSidebarWidth = (value: number) =>
  Math.min(NOTES_SIDEBAR_MAX_WIDTH, Math.max(NOTES_SIDEBAR_MIN_WIDTH, value));

function readNoteSortBy(): NoteSortBy {
  if (typeof window === "undefined") return "updatedAt";
  const value = window.localStorage.getItem(NOTE_SORT_STORAGE_KEY);
  return value === "createdAt" || value === "recordedAt" ? value : "updatedAt";
}

function formatAudioDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function formatAudioDate(dateStr: string): string {
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

type RediarizeDiagnostics = {
  speakerCount?: number;
  matchedSegmentCount?: number;
  fallbackMatchedSegmentCount?: number;
  unmatchedSegmentCount?: number;
  missingTimestampCount?: number;
  diarizationSegmentCount?: number;
  lockedSegmentCount?: number;
  diarizationDiagnostics?: {
    windows?: Array<{
      skipped?: boolean;
      reason?: string | null;
      retriedWithGain?: boolean;
      segmentCount?: number;
    }>;
  };
};

function formatRediarizeDiagnostics(
  stats: RediarizeDiagnostics | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!stats) return undefined;
  const parts = [
    t("notes.editor.audioRediarizeStatsSpeakers", { count: stats.speakerCount ?? 0 }),
    t("notes.editor.audioRediarizeStatsMatched", { count: stats.matchedSegmentCount ?? 0 }),
  ];
  if ((stats.fallbackMatchedSegmentCount ?? 0) > 0) {
    parts.push(
      t("notes.editor.audioRediarizeStatsFallback", {
        count: stats.fallbackMatchedSegmentCount ?? 0,
      })
    );
  }
  if ((stats.unmatchedSegmentCount ?? 0) > 0) {
    parts.push(
      t("notes.editor.audioRediarizeStatsUnmatched", {
        count: stats.unmatchedSegmentCount ?? 0,
      })
    );
  }
  if ((stats.missingTimestampCount ?? 0) > 0) {
    parts.push(
      t("notes.editor.audioRediarizeStatsMissingTimestamp", {
        count: stats.missingTimestampCount ?? 0,
      })
    );
  }
  const windows = stats.diarizationDiagnostics?.windows || [];
  const skippedWindows = windows.filter(
    (window) => window.skipped || window.reason === "silent_or_no_audible_speech"
  ).length;
  const retriedWindows = windows.filter((window) => window.retriedWithGain).length;
  if (skippedWindows > 0) {
    parts.push(t("notes.editor.audioRediarizeStatsSkippedWindows", { count: skippedWindows }));
  }
  if (retriedWindows > 0) {
    parts.push(t("notes.editor.audioRediarizeStatsRetriedWindows", { count: retriedWindows }));
  }
  return parts.join(" · ");
}

function getMeetingEchoCancellationMessage(
  mode: MeetingAecMode | null,
  reason: MeetingAecReason | null,
  t: (key: string) => string
) {
  if (mode === "enabled") {
    return t("notes.recording.echoCancellation.enabled");
  }
  if (reason === "system-audio-missing") {
    return t("notes.recording.echoCancellation.systemAudioMissing");
  }
  if (reason === "system-audio-start-failed") {
    return t("notes.recording.echoCancellation.systemAudioFailed");
  }
  if (reason === "helper-unavailable" || reason === "unsupported-platform") {
    return t("notes.recording.echoCancellation.helperUnavailable");
  }
  if (reason === "helper-error") {
    return t("notes.recording.echoCancellation.helperError");
  }
  return mode === "fallback" || mode === "unavailable"
    ? t("notes.recording.echoCancellation.fallback")
    : null;
}

interface PersonalNotesViewProps {
  onOpenSettings?: (section: string) => void;
  onOpenSearch?: () => void;
  meetingRecordingRequest?: {
    noteId: number;
    folderId: number;
    event: any;
  } | null;
  onMeetingRecordingRequestHandled?: () => void;
}

export default function PersonalNotesView({
  onOpenSettings,
  onOpenSearch,
  meetingRecordingRequest,
  onMeetingRecordingRequestHandled,
}: PersonalNotesViewProps) {
  const isMeetingMode = useIsMeetingMode();
  const isNarrowWindow = useIsNarrowWindow();
  const { t } = useTranslation();
  const notes = useNotes();
  const activeNoteId = useActiveNoteId();
  const isSidePanelLayout = isMeetingMode || (isNarrowWindow && activeNoteId != null);
  const activeFolderId = useActiveFolderId();
  const [isSaving, setIsSaving] = useState(false);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [localEnhancedContent, setLocalEnhancedContent] = useState<string | null>(null);
  const [showActionManager, setShowActionManager] = useState(false);
  const [showNewNoteDialog, setShowNewNoteDialog] = useState(false);
  const [showAudioDownloadDialog, setShowAudioDownloadDialog] = useState(false);
  const [audioActionKey, setAudioActionKey] = useState<string | null>(null);
  const [audioBulkMerge, setAudioBulkMerge] = useState(false);
  const [audioBulkCompress, setAudioBulkCompress] = useState(false);
  const [showBulkExportDialog, setShowBulkExportDialog] = useState(false);
  const [noteSortBy, setNoteSortByState] = useState<NoteSortBy>(readNoteSortBy);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [noteAudioFiles, setNoteAudioFiles] = useState<NoteAudioFile[]>([]);
  const [diarizationTaskStatus, setDiarizationTaskStatus] = useState<DiarizationTaskStatus | null>(
    null
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isMiddlePaneCollapsed, setIsMiddlePaneCollapsed] = useState(false);
  const [notesSidebarWidth, setNotesSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(NOTES_SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) ? clampNotesSidebarWidth(saved) : NOTES_SIDEBAR_DEFAULT_WIDTH;
  });
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<number>>(new Set());
  const [exportFields, setExportFields] = useState<NoteExportField[]>([
    "transcript",
    "content",
    "enhanced_content",
  ]);
  const [exportFormat, setExportFormat] = useState<NoteExportFormat>("md");
  const availableTags = useMemo(
    () =>
      Array.from(new Set(notes.flatMap((note) => note.tags || []))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [notes]
  );
  const visibleNotes = useMemo(
    () =>
      selectedTags.length > 0
        ? notes.filter((note) => (note.tags || []).some((tag) => selectedTags.includes(tag)))
        : notes,
    [notes, selectedTags]
  );
  const selectedTagSummary = selectedTags[0] || "";
  const remainingSelectedTagCount = Math.max(0, selectedTags.length - 1);
  const tagCheckboxItemClass =
    "text-xs gap-2 rounded-md py-1.5 pl-8 pr-2 [&>span:first-child]:rounded-[3px] [&>span:first-child]:border [&>span:first-child]:border-border [&>span:first-child]:bg-background";

  useEffect(() => {
    setSelectedTags((current) => current.filter((tag) => availableTags.includes(tag)));
  }, [availableTags]);

  const refreshDiarizationTaskStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getDiarizationTaskStatus?.(activeNoteId ?? null);
      if (status) {
        setDiarizationTaskStatus(status);
      }
    } catch (error) {
      logger.warn("Failed to refresh diarization task status", error);
    }
  }, [activeNoteId]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getDiarizationTaskStatus?.(activeNoteId ?? null)
      .then((status) => {
        if (!cancelled && status) {
          setDiarizationTaskStatus(status);
        }
      })
      .catch((error) => logger.warn("Failed to load diarization task status", error));

    const unsubscribe = window.electronAPI.onDiarizationTaskStatus?.(() => {
      void refreshDiarizationTaskStatus();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [activeNoteId, refreshDiarizationTaskStatus]);
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [newNoteFolderId, setNewNoteFolderId] = useState<string>("");
  const [isCreatingNewNoteFolder, setIsCreatingNewNoteFolder] = useState(false);
  const [newNoteFolderName, setNewNoteFolderName] = useState("");
  const audioBulkAvailability = useMemo(
    () => getAudioBulkAvailability(noteAudioFiles),
    [noteAudioFiles]
  );
  const audioBulkAction = useMemo(
    () => getAudioBulkAction({ merge: audioBulkMerge, compress: audioBulkCompress }),
    [audioBulkCompress, audioBulkMerge]
  );
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const enhancedSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeNoteRef = useRef<number | null>(null);
  const [syncedNoteId, setSyncedNoteIdState] = useState<number | null>(null);
  const localContentRef = useRef(localContent);
  const localTitleRef = useRef(localTitle);
  const localEnhancedContentRef = useRef(localEnhancedContent);
  useEffect(() => {
    localContentRef.current = localContent;
    localTitleRef.current = localTitle;
  }, [localContent, localTitle]);
  useEffect(() => {
    localEnhancedContentRef.current = localEnhancedContent;
  }, [localEnhancedContent]);
  const markNoteAsSynced = (id: number | null) => {
    activeNoteRef.current = id;
    setSyncedNoteIdState(id);
  };
  const { toast } = useToast();
  const isCloudMode = useSettingsStore(selectIsCloudNoteFormattingMode);
  const effectiveModelId = useSettingsStore((s) => selectResolvedNoteFormatting(s).model);
  const noteFilesEnabled = useSettingsStore((s) => s.noteFilesEnabled);
  const fileManagerName = navigator.platform.startsWith("Mac")
    ? "Finder"
    : navigator.platform.startsWith("Win")
      ? "Explorer"
      : "Files";
  const { isComplete: isOnboardingComplete, complete: completeOnboarding } = useNotesOnboarding();

  const {
    state: actionProcessingState,
    actionName,
    outputTarget: actionOutputTarget,
    runAction,
  } = useActionProcessing(activeNoteId ?? null);
  const actionProcessingStateRef = useRef(actionProcessingState);
  actionProcessingStateRef.current = actionProcessingState;

  const isTranscribing = useMeetingRecordingStore((s) => s.isRecording);
  const realtimeTranscript = useMeetingRecordingStore((s) => s.transcript);
  const realtimeSegments = useMeetingRecordingStore((s) => s.segments);
  const recordingStartedAt = useMeetingRecordingStore((s) => s.recordingStartedAt);
  const micPartial = useMeetingRecordingStore((s) => s.micPartial);
  const systemPartial = useMeetingRecordingStore((s) => s.systemPartial);
  const recordingAecMode = useMeetingRecordingStore((s) => s.aecMode);
  const recordingAecReason = useMeetingRecordingStore((s) => s.aecReason);
  const diarizationSessionId = useMeetingRecordingStore((s) => s.diarizationSessionId);
  const recordingNoteId = useMeetingRecordingStore((s) => s.recordingNoteId);
  const recordingError = useMeetingRecordingStore((s) => s.error);

  const {
    folders,
    folderCounts,
    isLoading,
    isCreatingFolder,
    newFolderName,
    renamingFolderId,
    renameValue,
    showAddNotesDialog,
    newFolderInputRef,
    renameInputRef,
    setIsCreatingFolder,
    setNewFolderName,
    setRenamingFolderId,
    setRenameValue,
    setShowAddNotesDialog,
    loadFolders,
    handleCreateFolder,
    handleConfirmRename,
    handleDeleteFolder,
    handleReorderFolders,
  } = useFolderManagement(noteSortBy);

  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();

  useEffect(() => {
    if (!recordingError) return;
    toast({
      title: t("notes.recording.errorTitle"),
      description: recordingError,
      variant: "destructive",
    });
    useMeetingRecordingStore.setState({ error: null });
  }, [recordingError, toast, t]);

  const requestDeleteFolder = useCallback(
    (folder: { id: number; name: string }) => {
      const count = folderCounts[folder.id] ?? 0;
      showConfirmDialog({
        title: t("notes.folders.deleteTitle"),
        description:
          count > 0
            ? t("notes.folders.deleteDescription", { name: folder.name, count })
            : t("notes.folders.deleteDescriptionEmpty", { name: folder.name }),
        confirmText: t("notes.folders.deleteConfirm"),
        variant: "destructive",
        onConfirm: () => handleDeleteFolder(folder.id),
      });
    },
    [folderCounts, handleDeleteFolder, showConfirmDialog, t]
  );

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;
  const selectedCount = selectedNoteIds.size;

  const clearNoteSelection = useCallback(() => {
    setSelectedNoteIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const toggleNoteSelection = useCallback((noteId: number) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const toggleExportField = useCallback((field: NoteExportField) => {
    setExportFields((prev) =>
      prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field]
    );
  }, []);

  const handleSelectAllVisibleNotes = useCallback(() => {
    setSelectedNoteIds(new Set(visibleNotes.map((note) => note.id)));
  }, [visibleNotes]);

  const handleNoteSortChange = useCallback(
    async (value: string) => {
      const nextSortBy: NoteSortBy =
        value === "createdAt" || value === "recordedAt" ? value : "updatedAt";
      setNoteSortByState(nextSortBy);
      window.localStorage.setItem(NOTE_SORT_STORAGE_KEY, nextSortBy);
      if (activeFolderId) {
        await initializeNotes(null, 50, activeFolderId, nextSortBy);
      }
    },
    [activeFolderId]
  );

  const handleRecordedAtChange = useCallback(
    async (noteId: number, recordedAt: string) => {
      const result = await window.electronAPI.updateNote(noteId, { recorded_at: recordedAt });
      if (!result.success || !result.note) {
        throw new Error(t("notes.editor.recordedDateSaveFailed"));
      }
      updateNoteInStore(result.note);
      await initializeNotes(null, 50, activeFolderId, noteSortBy);
    },
    [activeFolderId, noteSortBy, t]
  );

  const handleTagsChange = useCallback(
    async (noteId: number, tags: string[]) => {
      const result = await window.electronAPI.updateNote(noteId, { tags });
      if (!result.success || !result.note) {
        throw new Error(t("notes.tags.saveFailed"));
      }
      updateNoteInStore(result.note);
    },
    [t]
  );

  const handleExportSelectedNotes = useCallback(async () => {
    if (selectedNoteIds.size === 0 || exportFields.length === 0) return;
    setIsBulkExporting(true);
    try {
      const result = await window.electronAPI.exportSelectedNotes([...selectedNoteIds], {
        fields: exportFields,
        format: exportFormat,
      });
      if (result.success) {
        toast({
          title: t("notes.bulkExport.successTitle"),
          description: t("notes.bulkExport.successDescription", {
            count: result.exported ?? selectedNoteIds.size,
          }),
        });
        setShowBulkExportDialog(false);
        clearNoteSelection();
      } else if (!result.canceled) {
        toast({
          title: t("notes.bulkExport.errorTitle"),
          description: result.error || t("notes.bulkExport.errorDescription"),
          variant: "destructive",
        });
      }
    } finally {
      setIsBulkExporting(false);
    }
  }, [clearNoteSelection, exportFields, exportFormat, selectedNoteIds, t, toast]);

  useEffect(() => {
    setSelectedNoteIds((prev) => {
      const visibleIds = new Set(notes.map((note) => note.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    clearNoteSelection();
  }, [activeFolderId, clearNoteSelection]);

  const loadNoteAudioFiles = useCallback(async (noteId: number | null) => {
    if (!noteId) {
      setNoteAudioFiles([]);
      return [];
    }
    const result = await window.electronAPI.getNoteAudioFiles?.(noteId);
    const files = result?.success ? (result.files ?? []) : [];
    setNoteAudioFiles(files);
    return files;
  }, []);

  useEffect(() => {
    loadNoteAudioFiles(activeNoteId);
  }, [activeNoteId, activeNote?.source_file, loadNoteAudioFiles]);

  // Derive folder name for the metadata chip
  const activeFolderName = useMemo(() => {
    if (!activeNote?.folder_id) return null;
    return folders.find((f) => f.id === activeNote.folder_id)?.name ?? null;
  }, [activeNote?.folder_id, folders]);

  const startRecording = useCallback(async () => {
    const noteId = activeNoteRef.current;
    const note = notes.find((n) => n.id === noteId);
    const seedSegments = note?.transcript ? parseTranscriptSegments(note.transcript) : [];
    await storeStartRecording({
      noteId,
      noteTitle: note?.title ?? null,
      folderId: note?.folder_id ?? null,
      seedSegments,
      diarizationEnabled: note?.diarization_enabled == null ? null : note.diarization_enabled === 1,
      expectedCount: note?.expected_speaker_count ?? null,
    });
  }, [notes]);

  const stopRecording = useCallback(async () => {
    await storeStopRecording();
  }, []);

  useEffect(() => {
    if (activeNote && activeNote.id !== activeNoteRef.current) {
      // --- Switching notes ---
      // 1. Capture old note state before anything changes
      const oldNoteId = activeNoteRef.current;
      const oldTitle = localTitleRef.current;
      const oldContent = localContentRef.current;
      const oldEnhancedContent = localEnhancedContentRef.current;
      const hadPendingSave = !!saveTimeoutRef.current;
      const hadPendingEnhancedSave = !!enhancedSaveTimeoutRef.current;

      // 2. Clear all pending timers
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (enhancedSaveTimeoutRef.current) {
        clearTimeout(enhancedSaveTimeoutRef.current);
        enhancedSaveTimeoutRef.current = null;
      }

      // 3. Switch to new note IMMEDIATELY (no await, eliminates race window)
      markNoteAsSynced(activeNote.id);
      setLocalTitle(activeNote.title);
      setLocalContent(activeNote.content);
      setLocalEnhancedContent(activeNote.enhanced_content ?? null);
      // Also update refs directly so callbacks are correct before next render
      localTitleRef.current = activeNote.title;
      localContentRef.current = activeNote.content;
      localEnhancedContentRef.current = activeNote.enhanced_content ?? null;

      // 4. Flush old note data fire-and-forget (uses captured values, not refs)
      if ((hadPendingSave || hadPendingEnhancedSave) && oldNoteId) {
        const updates: { title?: string; content?: string; enhanced_content?: string | null } = {};
        if (hadPendingSave) {
          updates.title = oldTitle;
          updates.content = oldContent;
        }
        if (hadPendingEnhancedSave) {
          updates.enhanced_content = oldEnhancedContent;
        }
        window.electronAPI.updateNote(oldNoteId, updates).catch((err: unknown) => {
          logger.warn("Failed to flush note on switch", { error: (err as Error).message }, "notes");
        });
      }
    } else if (activeNote && activeNote.id === activeNoteRef.current && !saveTimeoutRef.current) {
      // External update (e.g. AI chat tool) — resync only when no user save is pending
      if (activeNote.title !== localTitleRef.current) {
        localTitleRef.current = activeNote.title;
        setLocalTitle(activeNote.title);
      }
      if (activeNote.content !== localContentRef.current) {
        localContentRef.current = activeNote.content;
        setLocalContent(activeNote.content);
      }
      if ((activeNote.enhanced_content ?? null) !== localEnhancedContentRef.current) {
        localEnhancedContentRef.current = activeNote.enhanced_content ?? null;
        setLocalEnhancedContent(activeNote.enhanced_content ?? null);
      }
    } else if (!activeNote) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (enhancedSaveTimeoutRef.current) {
        clearTimeout(enhancedSaveTimeoutRef.current);
        enhancedSaveTimeoutRef.current = null;
      }
      markNoteAsSynced(null);
      setLocalTitle("");
      setLocalContent("");
      setLocalEnhancedContent(null);
    }
  }, [activeNote]);

  const debouncedSave = useCallback((noteId: number, title: string, content: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      saveTimeoutRef.current = null;
      if (actionProcessingStateRef.current !== "idle") {
        logger.info(
          "Skipped pending note autosave because action is running",
          {
            noteId,
            actionProcessingState: actionProcessingStateRef.current,
            titleLength: title.length,
            contentLength: content.length,
          },
          "note-actions"
        );
        return;
      }
      setIsSaving(true);
      try {
        await window.electronAPI.updateNote(noteId, { title, content });
      } catch (err) {
        logger.warn("Failed to save note", { error: (err as Error).message }, "notes");
      } finally {
        setIsSaving(false);
      }
    }, 1000);
  }, []);

  const flushPendingNoteSaves = useCallback(async (noteId: number) => {
    const updates: { title?: string; content?: string; enhanced_content?: string | null } = {};

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      updates.title = localTitleRef.current;
      updates.content = localContentRef.current;
    }

    if (enhancedSaveTimeoutRef.current) {
      clearTimeout(enhancedSaveTimeoutRef.current);
      enhancedSaveTimeoutRef.current = null;
      updates.enhanced_content = localEnhancedContentRef.current;
    }

    if (Object.keys(updates).length === 0) return;

    setIsSaving(true);
    try {
      await window.electronAPI.updateNote(noteId, updates);
    } catch (err) {
      logger.warn("Failed to flush pending note save", { error: (err as Error).message }, "notes");
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (enhancedSaveTimeoutRef.current) clearTimeout(enhancedSaveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    actionProcessingStateRef.current = actionProcessingState;
    if (actionProcessingState === "idle") return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      logger.info(
        "Cleared pending note autosave while action is running",
        { noteId: activeNoteRef.current, actionProcessingState, actionOutputTarget },
        "note-actions"
      );
    }

    if (enhancedSaveTimeoutRef.current) {
      clearTimeout(enhancedSaveTimeoutRef.current);
      enhancedSaveTimeoutRef.current = null;
      logger.info(
        "Cleared pending enhanced note autosave while action is running",
        { noteId: activeNoteRef.current, actionProcessingState, actionOutputTarget },
        "note-actions"
      );
    }
  }, [actionOutputTarget, actionProcessingState]);

  const handleTitleChange = useCallback(
    (title: string) => {
      if (actionProcessingStateRef.current !== "idle") {
        logger.info(
          "Ignored title autosave while action is running",
          {
            noteId: activeNoteRef.current,
            actionProcessingState: actionProcessingStateRef.current,
          },
          "note-actions"
        );
        return;
      }
      setLocalTitle(title);
      if (activeNoteRef.current)
        debouncedSave(activeNoteRef.current, title, localContentRef.current);
    },
    [debouncedSave]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      if (actionProcessingStateRef.current !== "idle") {
        logger.info(
          "Ignored content autosave while action is running",
          {
            noteId: activeNoteRef.current,
            actionProcessingState: actionProcessingStateRef.current,
            contentLength: content.length,
          },
          "note-actions"
        );
        return;
      }
      setLocalContent(content);
      if (activeNoteRef.current)
        debouncedSave(activeNoteRef.current, localTitleRef.current, content);
    },
    [debouncedSave]
  );

  const handleEnhancedContentChange = useCallback((content: string) => {
    if (actionProcessingStateRef.current !== "idle") {
      logger.info(
        "Ignored enhanced content autosave while action is running",
        {
          noteId: activeNoteRef.current,
          actionProcessingState: actionProcessingStateRef.current,
          contentLength: content.length,
        },
        "note-actions"
      );
      return;
    }
    setLocalEnhancedContent(content);
    if (!activeNoteRef.current) return;
    const noteId = activeNoteRef.current;
    if (enhancedSaveTimeoutRef.current) clearTimeout(enhancedSaveTimeoutRef.current);
    enhancedSaveTimeoutRef.current = setTimeout(async () => {
      enhancedSaveTimeoutRef.current = null;
      if (actionProcessingStateRef.current !== "idle") {
        logger.info(
          "Skipped pending enhanced note autosave because action is running",
          {
            noteId,
            actionProcessingState: actionProcessingStateRef.current,
            contentLength: content.length,
          },
          "note-actions"
        );
        return;
      }
      setIsSaving(true);
      try {
        await window.electronAPI.updateNote(noteId, { enhanced_content: content });
      } finally {
        setIsSaving(false);
      }
    }, 1000);
  }, []);

  const handleNewNote = useCallback(async () => {
    if (!activeFolderId) return;
    const result = await window.electronAPI.saveNote(
      t("notes.list.untitledNote"),
      "",
      "personal",
      null,
      null,
      activeFolderId
    );
    if (result.success && result.note) {
      setActiveNoteId(result.note.id);
      loadFolders();
    }
  }, [activeFolderId, loadFolders, t]);

  const handleOpenNewNoteDialog = useCallback(() => {
    const personal = findDefaultFolder(folders);
    setNewNoteFolderId(personal ? String(personal.id) : folders[0] ? String(folders[0].id) : "");
    setShowNewNoteDialog(true);
  }, [folders]);

  const handleNewNoteFolderChange = useCallback((val: string) => {
    if (val === "__create_new__") {
      setIsCreatingNewNoteFolder(true);
      return;
    }
    setNewNoteFolderId(val);
  }, []);

  const handleCreateNewNoteFolder = useCallback(async () => {
    const trimmed = newNoteFolderName.trim();
    if (!trimmed) return;
    const res = await window.electronAPI.createFolder(trimmed);
    if (res.success && res.folder) {
      await loadFolders();
      setNewNoteFolderId(String(res.folder.id));
    }
    setNewNoteFolderName("");
    setIsCreatingNewNoteFolder(false);
  }, [newNoteFolderName, loadFolders]);

  const handleConfirmNewNote = useCallback(async () => {
    const folderId = Number(newNoteFolderId);
    if (!folderId) return;
    const result = await window.electronAPI.saveNote(
      t("notes.list.untitledNote"),
      "",
      "personal",
      null,
      null,
      folderId
    );
    if (result.success && result.note) {
      setActiveFolderId(folderId);
      setActiveNoteId(result.note.id);
      loadFolders();
    }
    setShowNewNoteDialog(false);
  }, [newNoteFolderId, loadFolders, t]);

  const handleNotesAdded = useCallback(async () => {
    if (activeFolderId) {
      await initializeNotes(null, 50, activeFolderId, noteSortBy);
    }
    loadFolders();
  }, [activeFolderId, loadFolders, noteSortBy]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (enhancedSaveTimeoutRef.current) {
        clearTimeout(enhancedSaveTimeoutRef.current);
        enhancedSaveTimeoutRef.current = null;
      }
      const result = await deleteNoteAndRefresh({
        noteId: id,
        deleteNote: window.electronAPI.deleteNote,
        removeNote,
        loadFolders,
      });
      if (result.success && id === activeNoteRef.current) {
        markNoteAsSynced(null);
        setLocalTitle("");
        setLocalContent("");
        setLocalEnhancedContent(null);
        localTitleRef.current = "";
        localContentRef.current = "";
        localEnhancedContentRef.current = null;
      }
    },
    [loadFolders]
  );

  const handleMoveToFolder = useCallback(
    async (noteId: number, folderId: number) => {
      await window.electronAPI.updateNote(noteId, { folder_id: folderId });
      if (noteId === activeNoteId) {
        setActiveFolderId(folderId);
      } else {
        removeNote(noteId);
      }
      loadFolders();
    },
    [activeNoteId, loadFolders]
  );

  const { dragState, noteDragHandlers, folderDropHandlers } = useNoteDragAndDrop({
    onMoveToFolder: handleMoveToFolder,
    currentFolderId: activeFolderId,
  });
  const { folderReorderState, folderDragHandleProps, folderReorderDropHandlers } =
    useFolderReorderDrag({
      folders,
      onReorderFolders: handleReorderFolders,
    });

  const handleCreateFolderAndMove = useCallback(
    async (noteId: number, folderName: string) => {
      const result = await window.electronAPI.createFolder(folderName);
      if (result.success && result.folder) {
        await window.electronAPI.updateNote(noteId, { folder_id: result.folder.id });
        await loadFolders();
      } else if (result.error) {
        toast({
          title: t("notes.folders.couldNotCreate"),
          description: result.error,
          variant: "destructive",
        });
      }
    },
    [loadFolders, toast, t]
  );

  const isActiveNoteRecording = isTranscribing && recordingNoteId === activeNote?.id;
  const echoCancellationMessage = isActiveNoteRecording
    ? getMeetingEchoCancellationMessage(recordingAecMode, recordingAecReason, t)
    : null;
  const resolvedActiveTranscript = resolveNoteActionTranscript({
    isActiveNoteRecording,
    realtimeTranscript,
    persistedTranscript: activeNote?.transcript,
  });

  const isEnhancementStale = useMemo(() => {
    if (!activeNote?.enhanced_content || !activeNote?.enhanced_at_content_hash) return false;
    const actionInput = buildNoteActionInput({
      noteContent: localContent,
      rawTranscript: resolvedActiveTranscript,
      speakerLabels: {
        you: t("notes.speaker.you"),
        them: t("notes.speaker.them"),
      },
    });
    const currentHash = actionInput?.contentHash ?? makeActionContentHash(localContent);
    return currentHash !== activeNote.enhanced_at_content_hash;
  }, [
    activeNote?.enhanced_content,
    activeNote?.enhanced_at_content_hash,
    localContent,
    resolvedActiveTranscript,
    t,
  ]);

  const handleExportNote = useCallback(
    async (options: SingleNoteExportOptions) => {
      if (!activeNoteId) return;
      await window.electronAPI.exportNote(activeNoteId, options);
    },
    [activeNoteId]
  );

  const handleExportTranscript = useCallback(
    async (format: "txt" | "srt" | "json" | "md") => {
      if (!activeNoteId) return;
      await window.electronAPI.exportTranscript(activeNoteId, format);
    },
    [activeNoteId]
  );

  const downloadAudioFile = useCallback(
    async (audioFileId: number) => {
      if (!activeNoteId) return;
      const result = await window.electronAPI.downloadNoteAudio(activeNoteId, audioFileId);
      if (!result.success && !result.canceled) {
        toast({
          title: t("notes.editor.audioDownloadFailed"),
          description: result.error || t("notes.editor.audioUnavailableDescription"),
          variant: "destructive",
        });
      }
    },
    [activeNoteId, t, toast]
  );

  const showAudioFileInFolder = useCallback(
    async (audioFileId: number) => {
      if (!activeNoteId) return;
      const result = await window.electronAPI.showNoteAudioInFolder(activeNoteId, audioFileId);
      if (!result.success) {
        toast({
          title: t("notes.editor.audioShowInFolderFailed"),
          description: result.error || t("notes.editor.audioUnavailableDescription"),
          variant: "destructive",
        });
      }
    },
    [activeNoteId, t, toast]
  );

  const compressAudioFile = useCallback(
    async (audioFileId: number) => {
      if (!activeNoteId) return;
      const key = `compress-${audioFileId}`;
      setAudioActionKey(key);
      try {
        const result = await window.electronAPI.compressNoteAudio(activeNoteId, audioFileId);
        if (!result.success) {
          toast({
            title: t("notes.editor.audioCompressFailed"),
            description: result.error || t("notes.editor.audioUnavailableDescription"),
            variant: "destructive",
          });
          return;
        }
        await loadNoteAudioFiles(activeNoteId);
        toast({
          title: t("notes.editor.audioCompressed"),
          variant: "success",
          duration: 2000,
        });
      } finally {
        setAudioActionKey(null);
      }
    },
    [activeNoteId, loadNoteAudioFiles, t, toast]
  );

  const rediarizeAudioFile = useCallback(
    async (audioFileId: number, options?: RediarizeAudioOptions) => {
      if (!activeNoteId) return;
      const key = `rediarize-${audioFileId}`;
      setAudioActionKey(key);
      try {
        const result = await window.electronAPI.rediarizeNoteAudio?.(
          activeNoteId,
          audioFileId,
          options
        );
        if (!result?.success) {
          const diagnosticDescription = formatRediarizeDiagnostics(result, t);
          toast({
            title: t("notes.editor.audioRediarizeFailed"),
            description:
              [result?.error, diagnosticDescription].filter(Boolean).join(" · ") ||
              t("notes.editor.audioUnavailableDescription"),
            variant: "destructive",
          });
          return;
        }
        if (result.note) {
          updateNoteInStore(result.note);
        }
        await loadNoteAudioFiles(activeNoteId);
        const diagnosticsDescription = formatRediarizeDiagnostics(result, t);
        const hasUnmatched =
          (result.unmatchedSegmentCount ?? 0) > 0 || (result.missingTimestampCount ?? 0) > 0;
        toast({
          title: hasUnmatched
            ? t("notes.editor.audioRediarizedWithUnmatched")
            : t("notes.editor.audioRediarized"),
          description: diagnosticsDescription,
          variant: "success",
          duration: hasUnmatched ? 6000 : 3500,
        });
      } finally {
        setAudioActionKey(null);
      }
    },
    [activeNoteId, loadNoteAudioFiles, t, toast]
  );

  const mergeAudioFiles = useCallback(
    async (options: { mergedAndCompressed?: boolean } = {}) => {
      if (!activeNoteId) return null;
      setAudioActionKey("merge");
      try {
        const result = await window.electronAPI.mergeNoteAudioFiles(activeNoteId);
        if (!result.success) {
          toast({
            title: t("notes.editor.audioMergeFailed"),
            description: result.error || t("notes.editor.audioUnavailableDescription"),
            variant: "destructive",
          });
          return null;
        }
        const files = await loadNoteAudioFiles(activeNoteId);
        toast({
          title: options.mergedAndCompressed
            ? t("notes.editor.audioMergedAndCompressed")
            : t("notes.editor.audioMerged"),
          variant: "success",
          duration: 2000,
        });
        return files[0] ?? null;
      } finally {
        setAudioActionKey(null);
      }
    },
    [activeNoteId, loadNoteAudioFiles, t, toast]
  );

  const compressAllAudioFiles = useCallback(async () => {
    if (!activeNoteId) return;
    const targets = noteAudioFiles.filter((file) => file.extension?.toLowerCase() !== "webm");
    if (targets.length === 0) return;
    setAudioActionKey("bulk-compress");
    try {
      for (const file of targets) {
        const result = await window.electronAPI.compressNoteAudio(activeNoteId, file.id);
        if (!result.success) {
          toast({
            title: t("notes.editor.audioCompressFailed"),
            description: result.error || t("notes.editor.audioUnavailableDescription"),
            variant: "destructive",
          });
          return;
        }
      }
      await loadNoteAudioFiles(activeNoteId);
      toast({
        title: t("notes.editor.audioCompressed"),
        variant: "success",
        duration: 2000,
      });
    } finally {
      setAudioActionKey(null);
    }
  }, [activeNoteId, loadNoteAudioFiles, noteAudioFiles, t, toast]);

  const executeBulkAudioAction = useCallback(() => {
    const action = getAudioBulkAction({ merge: audioBulkMerge, compress: audioBulkCompress });
    if (action.operation === "none") return;
    if (action.operation === "compress") {
      compressAllAudioFiles();
      return;
    }

    setShowAudioDownloadDialog(false);
    showConfirmDialog({
      title: t("notes.editor.mergeAudioConfirmTitle"),
      description: t("notes.editor.mergeAudioConfirmDescription"),
      confirmText: t(action.labelKey),
      cancelText: t("common.cancel"),
      onConfirm: () => mergeAudioFiles({ mergedAndCompressed: audioBulkCompress }),
      variant: "destructive",
    });
  }, [
    audioBulkCompress,
    audioBulkMerge,
    compressAllAudioFiles,
    mergeAudioFiles,
    showConfirmDialog,
    t,
  ]);

  const handleDownloadOriginalAudio = useCallback(async () => {
    if (!activeNoteId) return;
    const files =
      noteAudioFiles.length > 0 ? noteAudioFiles : await loadNoteAudioFiles(activeNoteId);
    if (files.length === 0) {
      toast({
        title: t("notes.editor.originalAudioUnavailable"),
        description: t("notes.editor.audioUnavailableDescription"),
        variant: "destructive",
      });
      return;
    }
    if (files.length === 1) {
      await downloadAudioFile(files[0].id);
      return;
    }
    setShowAudioDownloadDialog(true);
  }, [activeNoteId, downloadAudioFile, loadNoteAudioFiles, noteAudioFiles, t, toast]);

  const handleManageSavedAudio = useCallback(async () => {
    if (!activeNoteId) return;
    const files =
      noteAudioFiles.length > 0 ? noteAudioFiles : await loadNoteAudioFiles(activeNoteId);
    if (files.length === 0) {
      toast({
        title: t("notes.editor.originalAudioUnavailable"),
        description: t("notes.editor.audioUnavailableDescription"),
        variant: "destructive",
      });
      return;
    }
    setShowAudioDownloadDialog(true);
  }, [activeNoteId, loadNoteAudioFiles, noteAudioFiles, t, toast]);

  const handleRediarizeSavedAudio = useCallback(
    async (options?: RediarizeAudioOptions) => {
      if (!activeNoteId) return;
      const files =
        noteAudioFiles.length > 0 ? noteAudioFiles : await loadNoteAudioFiles(activeNoteId);
      if (files.length === 0) {
        toast({
          title: t("notes.editor.originalAudioUnavailable"),
          description: t("notes.editor.audioUnavailableDescription"),
          variant: "destructive",
        });
        return;
      }
      if (files.length === 1) {
        await rediarizeAudioFile(files[0].id, options);
        return;
      }
      setShowAudioDownloadDialog(true);
    },
    [activeNoteId, loadNoteAudioFiles, noteAudioFiles, rediarizeAudioFile, t, toast]
  );

  const handleShowOriginalAudioInFolder = useCallback(async () => {
    if (!activeNoteId) return;
    const files =
      noteAudioFiles.length > 0 ? noteAudioFiles : await loadNoteAudioFiles(activeNoteId);
    if (files.length === 0) {
      toast({
        title: t("notes.editor.originalAudioUnavailable"),
        description: t("notes.editor.audioUnavailableDescription"),
        variant: "destructive",
      });
      return;
    }
    if (files.length === 1) {
      await showAudioFileInFolder(files[0].id);
      return;
    }
    setShowAudioDownloadDialog(true);
  }, [activeNoteId, loadNoteAudioFiles, noteAudioFiles, showAudioFileInFolder, t, toast]);

  useEffect(() => {
    if (!audioBulkAvailability.canMerge && audioBulkMerge) setAudioBulkMerge(false);
    if (!audioBulkAvailability.canCompress && audioBulkCompress) setAudioBulkCompress(false);
  }, [
    audioBulkAvailability.canCompress,
    audioBulkAvailability.canMerge,
    audioBulkCompress,
    audioBulkMerge,
  ]);

  useEffect(() => {
    if (!meetingRecordingRequest || activeNoteId !== meetingRecordingRequest.noteId) return;
    const note = notes.find((n) => n.id === meetingRecordingRequest.noteId);
    const seedSegments = note?.transcript ? parseTranscriptSegments(note.transcript) : [];
    storeStartRecording({
      noteId: meetingRecordingRequest.noteId,
      noteTitle: note?.title ?? null,
      folderId: note?.folder_id ?? meetingRecordingRequest.folderId ?? null,
      seedSegments,
      diarizationEnabled: note?.diarization_enabled == null ? null : note.diarization_enabled === 1,
      expectedCount: note?.expected_speaker_count ?? null,
    });
    onMeetingRecordingRequestHandled?.();
  }, [meetingRecordingRequest, activeNoteId, notes, onMeetingRecordingRequestHandled]);

  const prevTranscribingRef = useRef(false);

  useEffect(() => {
    if (
      prevTranscribingRef.current &&
      !isTranscribing &&
      (realtimeTranscript || realtimeSegments.length > 0)
    ) {
      const note = recordingNoteId ? notes.find((n) => n.id === recordingNoteId) : null;
      const seedSegments = note?.transcript ? parseTranscriptSegments(note.transcript) : [];
      const persistedSegments =
        realtimeSegments.length > 0
          ? offsetAppendedTranscriptSegments(realtimeSegments, seedSegments, recordingStartedAt)
          : [];
      const transcript =
        persistedSegments.length > 0
          ? serializeTranscriptSegments(persistedSegments)
          : realtimeTranscript;

      if (recordingNoteId && transcript) {
        window.electronAPI.updateNote(recordingNoteId, { transcript });
      }
    }
    prevTranscribingRef.current = isTranscribing;
  }, [
    isTranscribing,
    realtimeTranscript,
    realtimeSegments,
    recordingNoteId,
    recordingStartedAt,
    notes,
  ]);

  useEffect(() => {
    if (!isTranscribing) return;

    const interval = setInterval(() => {
      if (!recordingNoteId || realtimeSegments.length === 0) return;
      const note = notes.find((n) => n.id === recordingNoteId);
      const seedSegments = note?.transcript ? parseTranscriptSegments(note.transcript) : [];
      const persistedSegments = offsetAppendedTranscriptSegments(
        realtimeSegments,
        seedSegments,
        recordingStartedAt
      );
      window.electronAPI.updateNote(recordingNoteId, {
        transcript: serializeTranscriptSegments(persistedSegments),
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, [isTranscribing, realtimeSegments, recordingNoteId, recordingStartedAt, notes]);

  const isLocalSynced = syncedNoteId === activeNote?.id;
  const editorNote = activeNote
    ? {
        ...activeNote,
        title: isLocalSynced ? localTitle : activeNote.title,
        content: isLocalSynced ? localContent : activeNote.content,
      }
    : null;

  const handleNotesSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = notesSidebarWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const updateWidth = (clientX: number) => {
        const nextWidth = clampNotesSidebarWidth(startWidth + clientX - startX);
        setNotesSidebarWidth(nextWidth);
        localStorage.setItem(NOTES_SIDEBAR_WIDTH_KEY, String(nextWidth));
      };

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => updateWidth(moveEvent.clientX);
      const onPointerUp = (upEvent: globalThis.PointerEvent) => {
        updateWidth(upEvent.clientX);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [notesSidebarWidth]
  );

  if (!isOnboardingComplete) {
    return <NotesOnboarding onComplete={completeOnboarding} />;
  }

  return (
    <div className="ow-workspace-page flex overflow-hidden">
      <div
        className={cn(
          "ow-collapsible-pane relative overflow-visible",
          (isSidePanelLayout || isMiddlePaneCollapsed) && "border-r-transparent"
        )}
        style={{ width: isSidePanelLayout || isMiddlePaneCollapsed ? 0 : notesSidebarWidth }}
      >
        <div className="ow-collapsible-pane-content">
          <div className="h-full w-full shrink-0 ow-inner-sidebar">
            <div className="px-3 pt-4 pb-3 shrink-0 space-y-1">
              <button onClick={handleOpenNewNoteDialog} className="ow-inner-nav-item h-7">
                <SquarePen size={14} className="shrink-0" />
                {t("notes.sidebar.newNote")}
              </button>
              {onOpenSearch && (
                <button onClick={onOpenSearch} className="ow-inner-nav-item h-7">
                  <Search size={14} className="shrink-0" />
                  {t("notes.sidebar.searchNotes")}
                </button>
              )}
              <button onClick={() => setShowActionManager(true)} className="ow-inner-nav-item h-7">
                <Sparkles size={14} className="shrink-0" />
                {t("notes.sidebar.actions")}
              </button>
            </div>

            {/* Folders */}
            <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("notes.folders.title")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsCreatingFolder(true)}
                aria-label={t("notes.context.newFolder")}
                className="h-6 w-6 ow-icon-button-muted"
              >
                <Plus size={13} />
              </Button>
            </div>

            <div className="px-3 space-y-0.5">
              {folders.map((folder) => {
                const isActive = folder.id === activeFolderId;
                const isMeetings = folder.name === MEETINGS_FOLDER_NAME;
                const count = folderCounts[folder.id] || 0;
                const isRenaming = renamingFolderId === folder.id;

                if (isRenaming) {
                  return (
                    <div key={folder.id} className="px-2">
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleConfirmRename();
                          if (e.key === "Escape") {
                            setRenamingFolderId(null);
                            setRenameValue("");
                          }
                        }}
                        onBlur={handleConfirmRename}
                        className={FOLDER_INPUT_CLASS}
                      />
                    </div>
                  );
                }

                const isDragOver = dragState.dragOverFolderId === folder.id;
                const isDropSuccess = dragState.dropSuccessFolderId === folder.id;
                const isFolderDragging = folderReorderState.draggingFolderId === folder.id;
                const isFolderSortOver = folderReorderState.dragOverFolderId === folder.id;
                const noteFolderDropHandlers = folderDropHandlers(folder.id, folder.name);
                const folderSortDropHandlers = folderReorderDropHandlers(folder.id);

                return (
                  <button
                    key={folder.id}
                    onClick={() => setActiveFolderId(folder.id)}
                    onDragOver={(e) => {
                      folderSortDropHandlers.onDragOver(e);
                      noteFolderDropHandlers.onDragOver(e);
                    }}
                    onDragEnter={noteFolderDropHandlers.onDragEnter}
                    onDragLeave={(e) => {
                      folderSortDropHandlers.onDragLeave(e);
                      noteFolderDropHandlers.onDragLeave();
                    }}
                    onDrop={async (e) => {
                      await folderSortDropHandlers.onDrop(e);
                      await noteFolderDropHandlers.onDrop(e);
                    }}
                    className={cn(
                      "ow-list-row group relative h-8 gap-1.5 cursor-pointer border-y border-transparent",
                      isActive ? "ow-list-row-active" : "ow-list-row-idle",
                      isDragOver && !isMeetings && "bg-muted ring-1 ring-border-hover scale-[1.01]",
                      isDropSuccess &&
                        "bg-emerald-500/10 dark:bg-emerald-400/10 ring-1 ring-emerald-500/20",
                      isFolderDragging && "opacity-50",
                      isFolderSortOver &&
                        folderReorderState.dropPosition === "before" &&
                        "border-t-primary",
                      isFolderSortOver &&
                        folderReorderState.dropPosition === "after" &&
                        "border-b-primary"
                    )}
                  >
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={t("notes.folders.reorder")}
                      title={t("notes.folders.reorder")}
                      onClick={(e) => e.stopPropagation()}
                      className="h-5 w-3.5 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
                      {...folderDragHandleProps(folder)}
                    >
                      <GripVertical size={11} />
                    </span>
                    <FolderOpen
                      size={13}
                      className={cn(
                        "shrink-0 transition-colors duration-150",
                        isDragOver || isActive
                          ? "text-foreground/70"
                          : "text-muted-foreground group-hover:text-foreground/65"
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs truncate flex-1 transition-colors duration-150",
                        isDragOver || isActive
                          ? "text-foreground font-medium"
                          : "text-muted-foreground group-hover:text-foreground/75"
                      )}
                    >
                      {folder.name}
                    </span>

                    {isDropSuccess ? (
                      <Check
                        size={10}
                        className="text-emerald-500 dark:text-emerald-400 shrink-0 animate-[scale-in_200ms_ease-out]"
                      />
                    ) : (
                      <span
                        className={cn(
                          "text-xs tabular-nums shrink-0 transition-colors group-hover:opacity-0",
                          isActive ? "text-muted-foreground" : "text-muted-foreground/70"
                        )}
                      >
                        {count > 0 ? count : ""}
                      </span>
                    )}
                    {(!folder.is_default || noteFilesEnabled) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <span
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => e.stopPropagation()}
                            className="h-5 w-5 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity absolute right-1.5 text-muted-foreground hover:text-foreground hover:bg-background cursor-pointer"
                          >
                            <MoreHorizontal size={11} />
                          </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={4} className="min-w-32">
                          {noteFilesEnabled && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                window.electronAPI?.showFolderInExplorer?.(folder.name);
                              }}
                              className="text-xs gap-2 rounded-md px-2 py-1"
                            >
                              <ExternalLink size={11} className="text-muted-foreground/60" />
                              {t("notes.context.showInFileManager", { manager: fileManagerName })}
                            </DropdownMenuItem>
                          )}
                          {!folder.is_default && (
                            <>
                              {noteFilesEnabled && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingFolderId(folder.id);
                                  setRenameValue(folder.name);
                                }}
                                className="text-xs gap-2 rounded-md px-2 py-1"
                              >
                                <Pencil size={11} className="text-muted-foreground/60" />
                                {t("notes.context.rename")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteFolder(folder);
                                }}
                                className="text-xs gap-2 rounded-md px-2 py-1 text-destructive focus:text-destructive focus:bg-destructive/10"
                              >
                                <Trash2 size={11} />
                                {t("notes.context.delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </button>
                );
              })}

              {isCreatingFolder && (
                <div className="px-2">
                  <input
                    ref={newFolderInputRef}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    onBlur={handleCreateFolder}
                    placeholder={t("notes.folders.folderName")}
                    className={cn(FOLDER_INPUT_CLASS, "placeholder:text-foreground/20")}
                  />
                </div>
              )}
            </div>

            <div className="mx-4 h-px bg-border/70 dark:bg-white/8 my-3" />

            {/* Notes list */}
            <div className="flex items-center justify-between px-4 py-1.5 gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {isSelectionMode
                  ? t("notes.bulkExport.selectedCount", { count: selectedCount })
                  : t("notes.list.title")}
              </span>
              {isSelectionMode ? (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAllVisibleNotes}
                    className="h-6 px-2 text-[11px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    {t("notes.bulkExport.selectAll")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowBulkExportDialog(true)}
                    disabled={selectedCount === 0}
                    aria-label={t("notes.bulkExport.exportSelected")}
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <Download size={11} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearNoteSelection}
                    aria-label={t("common.cancel")}
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <X size={11} />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-0.5">
                  {notes.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsSelectionMode(true)}
                      aria-label={t("notes.bulkExport.select")}
                      title={t("notes.bulkExport.select")}
                      className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      <SquareCheckBig size={10} />
                    </Button>
                  )}
                  {availableTags.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          aria-label={t("notes.tags.filterTitle")}
                          title={t("notes.tags.filterTitle")}
                          className={cn(
                            "h-6 max-w-36 gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted",
                            selectedTags.length > 0 && "bg-muted text-foreground"
                          )}
                        >
                          <Tag size={10} className="shrink-0" />
                          {selectedTagSummary ? (
                            <>
                              <span className="min-w-0 truncate">{selectedTagSummary}</span>
                              {remainingSelectedTagCount > 0 && (
                                <span className="shrink-0 rounded bg-background/70 px-1 text-[10px] text-muted-foreground">
                                  +{remainingSelectedTagCount}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="min-w-0 truncate">{t("notes.tags.filterTitle")}</span>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4} className="min-w-40">
                        <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          {t("notes.tags.filterTitle")}
                        </DropdownMenuLabel>
                        <DropdownMenuItem className="text-xs" onSelect={() => setSelectedTags([])}>
                          {t("notes.tags.filterAll")}
                        </DropdownMenuItem>
                        {availableTags.map((tag) => (
                          <DropdownMenuCheckboxItem
                            key={tag}
                            checked={selectedTags.includes(tag)}
                            className={tagCheckboxItemClass}
                            onCheckedChange={(checked) =>
                              setSelectedTags((current) =>
                                checked
                                  ? Array.from(new Set([...current, tag]))
                                  : current.filter((item) => item !== tag)
                              )
                            }
                            onSelect={(event) => event.preventDefault()}
                          >
                            {tag}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("notes.list.sort")}
                        title={t("notes.list.sort")}
                        className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <ArrowDownUp size={10} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={4} className="min-w-36">
                      <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                        {t("notes.list.sort")}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={noteSortBy}
                        onValueChange={handleNoteSortChange}
                      >
                        <DropdownMenuRadioItem
                          value="updatedAt"
                          className="text-xs gap-2 rounded-md py-1"
                        >
                          {t("notes.list.sortUpdated")}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                          value="createdAt"
                          className="text-xs gap-2 rounded-md py-1"
                        >
                          {t("notes.list.sortCreated")}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                          value="recordedAt"
                          className="text-xs gap-2 rounded-md py-1"
                        >
                          {t("notes.list.sortRecorded")}
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNewNote}
                    aria-label={t("notes.list.newNote")}
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Plus size={11} />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={12} className="animate-spin text-foreground/15" />
                </div>
              ) : visibleNotes.length === 0 ? (
                <div className="ow-empty-state py-8 px-4">
                  <div className="ow-empty-state-visual mb-3 h-12 w-12">
                    <SquarePen size={18} strokeWidth={1.7} />
                  </div>
                  <p className="ow-empty-state-description mb-3">
                    {selectedTags.length > 0
                      ? t("notes.tags.noMatches")
                      : t("notes.empty.emptyFolder")}
                  </p>
                  <div className="flex flex-col gap-1.5 w-full max-w-36">
                    <button
                      onClick={handleNewNote}
                      className="flex items-center justify-center gap-1.5 h-6 rounded-md bg-foreground/[0.06] dark:bg-white/[0.08] border border-border/60 text-xs font-medium text-foreground/70 hover:bg-foreground/[0.08] hover:text-foreground hover:border-border-hover transition-colors"
                    >
                      <Plus size={10} />
                      {t("notes.empty.createNote")}
                    </button>
                    <button
                      onClick={() => setShowAddNotesDialog(true)}
                      className="flex items-center justify-center gap-1.5 h-6 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border-hover hover:bg-muted transition-colors"
                    >
                      {t("notes.addToFolder.addExisting")}
                    </button>
                  </div>
                </div>
              ) : (
                visibleNotes.map((note) => (
                  <NoteListItem
                    key={note.id}
                    note={note}
                    isActive={note.id === activeNoteId}
                    onClick={() => setActiveNoteId(note.id)}
                    onDelete={handleDelete}
                    folders={folders}
                    currentFolderId={activeFolderId}
                    onMoveToFolder={handleMoveToFolder}
                    onCreateFolderAndMove={handleCreateFolderAndMove}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedNoteIds.has(note.id)}
                    onToggleSelected={toggleNoteSelection}
                    dragHandlers={noteDragHandlers(note.id, note.title)}
                    isDragging={dragState.draggingNoteId === note.id}
                    noteFilesEnabled={noteFilesEnabled}
                    timestamp={
                      noteSortBy === "createdAt"
                        ? note.created_at
                        : noteSortBy === "recordedAt"
                          ? note.recorded_at || note.created_at
                          : note.updated_at
                    }
                  />
                ))
              )}
            </div>
          </div>
        </div>
        {!isSidePanelLayout && (
          <button
            type="button"
            className="ow-pane-toggle"
            onClick={() => setIsMiddlePaneCollapsed((value) => !value)}
            aria-label={
              isMiddlePaneCollapsed ? t("notes.expandNoteList") : t("notes.collapseNoteList")
            }
            title={isMiddlePaneCollapsed ? t("notes.expandNoteList") : t("notes.collapseNoteList")}
          >
            {isMiddlePaneCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        )}
        {!isSidePanelLayout && !isMiddlePaneCollapsed && (
          <button
            type="button"
            className="absolute inset-y-0 right-[-4px] z-10 w-2 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/25"
            aria-label={t("common.resize", { defaultValue: "Resize" })}
            onPointerDown={handleNotesSidebarResizeStart}
          />
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {editorNote ? (
          <>
            {echoCancellationMessage && (
              <div
                role="status"
                className={cn(
                  "mx-4 mt-3 rounded-md border px-3 py-2 text-xs leading-snug",
                  recordingAecMode === "enabled"
                    ? "border-success/20 bg-success/8 text-success"
                    : "border-warning/20 bg-warning/8 text-warning"
                )}
              >
                {echoCancellationMessage}
              </div>
            )}
            <NoteEditor
              key={editorNote.id}
              note={editorNote}
              onTitleChange={handleTitleChange}
              onContentChange={handleContentChange}
              isSaving={isSaving}
              isRecording={isActiveNoteRecording}
              isProcessing={false}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onExportNote={handleExportNote}
              onExportTranscript={handleExportTranscript}
              onDownloadOriginalAudio={handleDownloadOriginalAudio}
              onShowOriginalAudioInFolder={handleShowOriginalAudioInFolder}
              onManageSavedAudio={handleManageSavedAudio}
              onRediarizeAudio={handleRediarizeSavedAudio}
              hasDownloadableAudio={noteAudioFiles.length > 0}
              noteAudioFiles={noteAudioFiles}
              audioActionKey={audioActionKey}
              diarizationTaskStatus={diarizationTaskStatus}
              onMergeAudioFiles={() => mergeAudioFiles()}
              enhancement={
                localEnhancedContent
                  ? {
                      content: localEnhancedContent,
                      isStale: isEnhancementStale,
                      onChange: handleEnhancedContentChange,
                    }
                  : undefined
              }
              diarizationSessionId={diarizationSessionId}
              recordingStartedAt={isActiveNoteRecording ? recordingStartedAt : null}
              meetingTranscript={isActiveNoteRecording ? realtimeTranscript : ""}
              meetingSegments={isActiveNoteRecording ? realtimeSegments : []}
              meetingMicPartial={isActiveNoteRecording ? micPartial : ""}
              meetingSystemPartial={isActiveNoteRecording ? systemPartial : ""}
              onLiveSpeakerLock={lockSpeaker}
              liveTranscript={isActiveNoteRecording ? realtimeTranscript : ""}
              folderName={activeFolderName}
              folders={folders}
              onMoveToFolder={handleMoveToFolder}
              onCreateFolderAndMove={handleCreateFolderAndMove}
              onRecordedAtChange={handleRecordedAtChange}
              availableTags={availableTags}
              onTagsChange={handleTagsChange}
              actionProcessingState={actionProcessingState}
              actionName={actionName}
              actionOutputTarget={actionOutputTarget}
              actionPicker={
                <ActionPicker
                  onRunAction={async (action) => {
                    if (!editorNote) return;
                    await flushPendingNoteSaves(editorNote.id);
                    const rawTranscript = resolveNoteActionTranscript({
                      isActiveNoteRecording,
                      realtimeTranscript,
                      persistedTranscript: editorNote.transcript,
                    });
                    const currentTitle = localTitleRef.current;
                    const currentContent = localContentRef.current;
                    const currentEnhancedContent = localEnhancedContentRef.current;
                    const actionInput = buildNoteActionInput({
                      noteContent: currentContent,
                      rawTranscript,
                      speakerLabels: {
                        you: t("notes.speaker.you"),
                        them: t("notes.speaker.them"),
                      },
                    });
                    if (!actionInput) return;

                    runAction(action, actionInput.content, actionInput.contentHash, {
                      isCloudMode,
                      modelId: effectiveModelId,
                      isMeetingNote: actionInput.isMeetingNote,
                      currentTitle,
                      currentContent,
                      currentEnhancedContent,
                      currentTranscript: rawTranscript,
                      currentRecordedAt: editorNote.recorded_at,
                      currentCreatedAt: editorNote.created_at,
                      speakerLabels: {
                        you: t("notes.speaker.you"),
                        them: t("notes.speaker.them"),
                      },
                    });
                  }}
                  onManageActions={() => setShowActionManager(true)}
                  disabled={
                    (!editorNote?.content?.trim() &&
                      !resolvedActiveTranscript &&
                      !activeNote?.transcript) ||
                    actionProcessingState === "processing"
                  }
                />
              }
            />
            <ActionManagerDialog open={showActionManager} onOpenChange={setShowActionManager} />
          </>
        ) : (
          <div className="ow-empty-state flex-1 -mt-6">
            <div className="ow-empty-state-visual">
              <SquarePen size={24} strokeWidth={1.7} />
            </div>
            {notes.length === 0 ? (
              <>
                <h3 className="ow-empty-state-title">{t("notes.empty.title")}</h3>
                <p className="ow-empty-state-description">{t("notes.empty.description")}</p>
                <div className="ow-empty-state-actions">
                  <button
                    onClick={handleNewNote}
                    className="flex items-center gap-1.5 px-4 h-7 rounded-md bg-foreground text-background border border-foreground text-xs font-semibold hover:bg-foreground/90 transition-colors"
                  >
                    <Plus size={11} />
                    {t("notes.empty.createNote")}
                  </button>
                  <button
                    onClick={() => setShowAddNotesDialog(true)}
                    className="flex items-center gap-1.5 px-4 h-7 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border-hover hover:bg-muted transition-colors"
                  >
                    {t("notes.addToFolder.addExisting")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="ow-empty-state-title">{t("notes.empty.selectTitle")}</h3>
                <p className="ow-empty-state-description">{t("notes.empty.selectDescription")}</p>
              </>
            )}
          </div>
        )}
      </div>

      {activeFolderId && (
        <AddNotesToFolderDialog
          open={showAddNotesDialog}
          onOpenChange={setShowAddNotesDialog}
          targetFolderId={activeFolderId}
          onNotesAdded={handleNotesAdded}
        />
      )}

      <Dialog open={showBulkExportDialog} onOpenChange={setShowBulkExportDialog}>
        <DialogContent className="sm:max-w-105 p-6 gap-5">
          <DialogHeader>
            <DialogTitle>{t("notes.bulkExport.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground/50">
                {t("notes.bulkExport.fields")}
              </p>
              <div className="space-y-1">
                {[
                  ["transcript", t("notes.bulkExport.fieldTranscript")],
                  ["content", t("notes.bulkExport.fieldNotes")],
                  ["enhanced_content", t("notes.bulkExport.fieldEnhanced")],
                ].map(([field, label]) => {
                  const typedField = field as NoteExportField;
                  const checked = exportFields.includes(typedField);
                  return (
                    <button
                      key={field}
                      type="button"
                      onClick={() => toggleExportField(typedField)}
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-foreground/5 transition-colors"
                    >
                      <span
                        className={cn(
                          "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          checked
                            ? "border-foreground/70 bg-foreground text-background"
                            : "border-border bg-background text-transparent"
                        )}
                      >
                        <Check size={11} />
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/50">
                {t("notes.bulkExport.format")}
              </label>
              <Select
                value={exportFormat}
                onValueChange={(value) => setExportFormat(value as NoteExportFormat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="md">{t("notes.bulkExport.formatMarkdown")}</SelectItem>
                  <SelectItem value="txt">{t("notes.bulkExport.formatText")}</SelectItem>
                  <SelectItem value="pdf">{t("notes.bulkExport.formatPdf")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowBulkExportDialog(false)}
              disabled={isBulkExporting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleExportSelectedNotes}
              disabled={isBulkExporting || selectedCount === 0 || exportFields.length === 0}
            >
              {isBulkExporting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  {t("notes.bulkExport.exporting")}
                </>
              ) : (
                t("notes.bulkExport.exportFiles", { count: selectedCount })
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showAudioDownloadDialog}
        onOpenChange={(open) => {
          setShowAudioDownloadDialog(open);
          if (!open) {
            setAudioBulkMerge(false);
            setAudioBulkCompress(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-105 p-6 gap-5">
          <DialogHeader>
            <DialogTitle>{t("notes.editor.chooseAudioFile")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {noteAudioFiles.map((file) => {
              const recordedAt = file.recorded_at || file.created_at;
              const dateLabel = recordedAt ? formatAudioDate(recordedAt) : file.filename;
              const duration = formatAudioDuration(file.duration_seconds);
              const size = formatFileSize(file.size_bytes);
              const details = [duration, size, file.extension?.toUpperCase()].filter(Boolean);
              const isCompressing = audioActionKey === `compress-${file.id}`;
              const isRediarizing = audioActionKey === `rediarize-${file.id}`;
              const isWebm = file.extension?.toLowerCase() === "webm";
              const rediarizeTitle = isRediarizing
                ? t("notes.editor.rediarizingAudio")
                : t("notes.editor.rediarizeAudio");
              return (
                <div
                  key={file.id}
                  className="w-full flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left"
                >
                  <FileAudio size={16} className="text-foreground/50 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground truncate">
                      {dateLabel}
                    </span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {isRediarizing
                        ? t("notes.editor.rediarizingAudio")
                        : details.join(" \u00b7 ") || file.filename}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-sm"
                      title={t("notes.editor.downloadAudio")}
                      onClick={() => downloadAudioFile(file.id)}
                    >
                      <Download size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-sm"
                      title={t("notes.editor.showAudioInFolder")}
                      onClick={() => showAudioFileInFolder(file.id)}
                    >
                      <FolderOpen size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-sm"
                      title={rediarizeTitle}
                      aria-label={rediarizeTitle}
                      disabled={isRediarizing || audioActionKey !== null}
                      onClick={() => rediarizeAudioFile(file.id)}
                    >
                      {isRediarizing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-sm"
                      title={t("notes.editor.compressAudio")}
                      disabled={isWebm || isCompressing || audioActionKey !== null}
                      onClick={() => compressAudioFile(file.id)}
                    >
                      {isCompressing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <FileAudio size={13} />
                      )}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
          <DialogFooter className="gap-3 sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <label
                className={cn(
                  "flex items-center gap-2 text-xs font-medium text-foreground",
                  (!audioBulkAvailability.canMerge || audioActionKey !== null) &&
                    "cursor-not-allowed text-muted-foreground"
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-foreground"
                  checked={audioBulkMerge}
                  disabled={!audioBulkAvailability.canMerge || audioActionKey !== null}
                  onChange={(event) => setAudioBulkMerge(event.target.checked)}
                />
                {t("notes.editor.mergeAudio")}
              </label>
              <label
                className={cn(
                  "flex items-center gap-2 text-xs font-medium text-foreground",
                  (!audioBulkAvailability.canCompress || audioActionKey !== null) &&
                    "cursor-not-allowed text-muted-foreground"
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-foreground"
                  checked={audioBulkCompress}
                  disabled={!audioBulkAvailability.canCompress || audioActionKey !== null}
                  onChange={(event) => setAudioBulkCompress(event.target.checked)}
                />
                {t("notes.editor.compressAudio")}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowAudioDownloadDialog(false)}
                disabled={audioActionKey !== null}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={executeBulkAudioAction}
                disabled={audioBulkAction.operation === "none" || audioActionKey !== null}
              >
                {audioActionKey !== null ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {t(audioBulkAction.runningLabelKey)}
                  </>
                ) : (
                  <>
                    {audioBulkAction.operation === "merge" ? (
                      <ArrowDownUp size={13} />
                    ) : (
                      <FileAudio size={13} />
                    )}
                    {t(audioBulkAction.labelKey)}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showNewNoteDialog}
        onOpenChange={(open) => {
          setShowNewNoteDialog(open);
          if (!open) {
            setIsCreatingNewNoteFolder(false);
            setNewNoteFolderName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-95 p-6 gap-5">
          <DialogHeader>
            <DialogTitle>
              {isCreatingNewNoteFolder ? t("notes.upload.newFolder") : t("notes.sidebar.newNote")}
            </DialogTitle>
          </DialogHeader>

          {isCreatingNewNoteFolder ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/50">
                {t("notes.upload.folderName")}
              </label>
              <Input
                value={newNoteFolderName}
                onChange={(e) => setNewNoteFolderName(e.target.value)}
                placeholder={t("notes.folders.folderName")}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateNewNoteFolder();
                }}
              />
            </div>
          ) : (
            folders.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/50">
                  {t("notes.folders.title")}
                </label>
                <Select value={newNoteFolderId} onValueChange={handleNewNoteFolderChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("notes.upload.selectFolder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.name}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value="__create_new__">
                      <span className="flex items-center gap-1.5 text-foreground/60">
                        <Plus size={13} />
                        {t("notes.upload.newFolder")}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )
          )}

          <DialogFooter>
            {isCreatingNewNoteFolder ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsCreatingNewNoteFolder(false);
                    setNewNoteFolderName("");
                  }}
                >
                  {t("common.back")}
                </Button>
                <Button onClick={handleCreateNewNoteFolder} disabled={!newNoteFolderName.trim()}>
                  {t("notes.upload.create")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setShowNewNoteDialog(false)}>
                  {t("notes.upload.cancel")}
                </Button>
                <Button onClick={handleConfirmNewNote} disabled={!newNoteFolderId}>
                  {t("notes.upload.create")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
    </div>
  );
}
