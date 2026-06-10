import { create } from "zustand";
import {
  createInitialUploadTranscriptionState,
  selectUploadFile,
  startUploadTask,
  completeUploadTask,
  failUploadTask,
  resetUploadTask,
  buildUploadNoteSaveArgs,
} from "./uploadTranscriptionCore";

export type UploadTranscriptionState = "idle" | "selected" | "transcribing" | "complete" | "error";

export interface UploadTranscriptionFile {
  name: string;
  path: string;
  size: string;
  sizeBytes: number;
}

export interface UploadTranscriptionResult {
  success: boolean;
  text?: string;
  segments?: Array<{
    id?: string;
    text?: string;
    source?: "mic" | "system";
    timestamp?: number;
    start?: number;
    startTime?: number;
    speaker?: string;
    speakerName?: string;
    speakerIsPlaceholder?: boolean;
  }>;
  error?: string;
  code?: string;
  warning?: string | null;
  partial?: boolean;
}

export interface UploadTranscriptionProgress {
  jobId?: string;
  stage?: string;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed?: number;
  currentChunk?: number;
  message?: string;
}

export interface RunUploadTranscriptionOptions {
  useChunkProgress: boolean;
  registerProgress?: (callback: (data: UploadTranscriptionProgress) => void) => (() => void) | null;
  transcribe: () => Promise<UploadTranscriptionResult>;
  cancelTranscription?: () => Promise<{ success: boolean; error?: string; code?: string }>;
  generateTitle: (text: string) => Promise<string>;
  saveNote: (
    title: string,
    content: string,
    noteType: string,
    sourceFile: string,
    audioDuration: number | null,
    folderId: number | null,
    transcript?: string | null
  ) => Promise<{ success: boolean; note?: { id: number }; error?: string }>;
  afterNoteCreated?: (payload: {
    noteId: number;
    file: UploadTranscriptionFile;
    response: UploadTranscriptionResult;
  }) => Promise<void>;
  noSpeechMessage: string;
  transcriptionFailedMessage: string;
  errorOccurredMessage: string;
}

interface UploadTranscriptionStoreState {
  state: UploadTranscriptionState;
  file: UploadTranscriptionFile | null;
  result: string | null;
  noteId: number | null;
  error: string | null;
  progress: number;
  chunkProgress: UploadTranscriptionProgress | null;
  selectedFolderId: string;
  activeTaskId: number | null;
  selectFile: (file: UploadTranscriptionFile) => void;
  setSelectedFolderId: (folderId: string) => void;
  setDefaultFolderId: (folderId: string) => void;
  reset: (defaultFolderId?: string) => void;
  runTranscription: (options: RunUploadTranscriptionOptions) => void;
  cancelTranscription: () => void;
}

let nextTaskId = 1;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let progressCleanup: (() => void) | null = null;
let currentCancelTranscription: (() => Promise<{ success: boolean; error?: string }>) | null = null;

function stopProgressTracking() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  if (progressCleanup) {
    progressCleanup();
    progressCleanup = null;
  }
  currentCancelTranscription = null;
}

function fallbackTitleFromText(text: string, fileName: string) {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return fileName.replace(/\.[^.]+$/, "");
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "..." : "");
}

export const useUploadTranscriptionStore = create<UploadTranscriptionStoreState>()((set, get) => ({
  ...createInitialUploadTranscriptionState(),
  activeTaskId: null,

  selectFile: (file) => {
    stopProgressTracking();
    set({ ...selectUploadFile(get(), file), activeTaskId: null });
  },

  setSelectedFolderId: (folderId) => set({ selectedFolderId: folderId }),

  setDefaultFolderId: (folderId) => {
    const current = get();
    if (current.selectedFolderId || current.state !== "idle") return;
    set({ selectedFolderId: folderId });
  },

  reset: (defaultFolderId = "") => {
    const cancel = currentCancelTranscription;
    stopProgressTracking();
    if (get().state === "transcribing" && cancel) {
      void cancel().catch(() => {});
    }
    set({ ...resetUploadTask(get(), { defaultFolderId }), activeTaskId: null });
  },

  cancelTranscription: () => {
    const current = get();
    if (current.state !== "transcribing") return;
    const file = current.file;
    const cancel = currentCancelTranscription;
    stopProgressTracking();
    if (cancel) {
      void cancel().catch(() => {});
    }
    if (file) {
      set({ ...selectUploadFile(get(), file), activeTaskId: null });
    } else {
      set({ ...resetUploadTask(get()), activeTaskId: null });
    }
  },

  runTranscription: (options) => {
    const current = get();
    if (!current.file || current.state === "transcribing") return;

    const taskId = nextTaskId++;
    const file = current.file;
    const selectedFolderId = current.selectedFolderId;

    stopProgressTracking();
    currentCancelTranscription = options.cancelTranscription || null;
    set({
      ...startUploadTask(current, file, { folderId: selectedFolderId }),
      activeTaskId: taskId,
    });

    if (options.useChunkProgress && options.registerProgress) {
      progressCleanup =
        options.registerProgress((data) => {
          if (get().activeTaskId !== taskId || data.chunksTotal <= 0) return;
          set({
            chunkProgress: data,
            progress: ((data.chunksCompleted + (data.chunksFailed || 0)) / data.chunksTotal) * 90,
          });
        }) ?? null;
    } else {
      progressTimer = setInterval(() => {
        if (get().activeTaskId !== taskId) return;
        set((state) => {
          if (state.progress >= 90) return { progress: state.progress };
          return { progress: Math.min(90, state.progress + Math.random() * 6) };
        });
      }, 500);
    }

    (async () => {
      try {
        const response = await options.transcribe();
        if (get().activeTaskId !== taskId) return;

        stopProgressTracking();

        if (!response.success || !response.text) {
          const message =
            response.code === "NO_SPEECH_DETECTED"
              ? options.noSpeechMessage
              : response.error || options.transcriptionFailedMessage;
          set({ ...failUploadTask(get(), message), activeTaskId: null });
          return;
        }

        set({ progress: 100, result: response.text });

        const fallbackTitle = fallbackTitleFromText(response.text, file.name);
        const aiTitle = await options.generateTitle(response.text);
        if (get().activeTaskId !== taskId) return;

        const folderId = selectedFolderId ? Number(selectedFolderId) : null;
        const noteArgs = buildUploadNoteSaveArgs({
          title: aiTitle || fallbackTitle,
          transcript: response.text,
          segments: response.segments,
          fileName: file.name,
          folderId,
        });
        const noteResponse = await options.saveNote(
          noteArgs.title,
          noteArgs.content,
          noteArgs.noteType,
          noteArgs.sourceFile,
          noteArgs.audioDuration,
          noteArgs.folderId,
          noteArgs.transcript
        );
        if (get().activeTaskId !== taskId) return;

        if (!noteResponse.success || !noteResponse.note) {
          set({
            ...failUploadTask(get(), noteResponse.error || options.errorOccurredMessage),
            activeTaskId: null,
          });
          return;
        }

        if (options.afterNoteCreated) {
          await options.afterNoteCreated({
            noteId: noteResponse.note.id,
            file,
            response,
          });
          if (get().activeTaskId !== taskId) return;
        }

        set({
          ...completeUploadTask(get(), {
            result: response.text,
            noteId: noteResponse.note.id,
            folderId: selectedFolderId,
          }),
          activeTaskId: null,
        });
      } catch (err) {
        if (get().activeTaskId !== taskId) return;
        stopProgressTracking();
        const message = err instanceof Error ? err.message : options.errorOccurredMessage;
        set({ ...failUploadTask(get(), message), activeTaskId: null });
      }
    })();
  },
}));
