import { create } from "zustand";
import type { ActionItem } from "../types/electron";
import { type ActionOutputTarget, validateActionUpdateResult } from "./actionProcessingCore";
import { loggableText, logNoteAction, makeNoteActionOperationId } from "./noteActionLogger";
import { runNoteActionOnce } from "./runNoteActionOnce";

export type ActionProcessingStatus = "idle" | "processing" | "success";

export interface NoteActionState {
  status: ActionProcessingStatus;
  actionName: string | null;
  outputTarget: ActionOutputTarget | null;
}

export interface ActionErrorEvent {
  noteId: number;
  message: string;
}

interface ActionProcessingStoreState {
  noteStates: Record<number, NoteActionState>;
  errorEvents: ActionErrorEvent[];
}

const cancelledFlags = new Map<number, boolean>();
const processingFlags = new Map<number, boolean>();
const successTimers = new Map<number, NodeJS.Timeout>();

const IDLE_STATE: NoteActionState = { status: "idle", actionName: null, outputTarget: null };

function setNoteState(noteId: number, patch: Partial<NoteActionState>) {
  const { noteStates } = useActionProcessingStore.getState();
  const prev = noteStates[noteId] ?? IDLE_STATE;
  useActionProcessingStore.setState({
    noteStates: { ...noteStates, [noteId]: { ...prev, ...patch } },
  });
}

function clearNoteState(noteId: number) {
  const { noteStates } = useActionProcessingStore.getState();
  const next = { ...noteStates };
  delete next[noteId];
  useActionProcessingStore.setState({ noteStates: next });
}

function pushErrorEvent(event: ActionErrorEvent) {
  const { errorEvents } = useActionProcessingStore.getState();
  useActionProcessingStore.setState({ errorEvents: [...errorEvents, event] });
}

export const useActionProcessingStore = create<ActionProcessingStoreState>()(() => ({
  noteStates: {},
  errorEvents: [],
}));

export interface RunActionOptions {
  isCloudMode: boolean;
  modelId: string;
  isMeetingNote?: boolean;
  currentTitle?: string | null;
  currentContent?: string | null;
  currentEnhancedContent?: string | null;
  currentTranscript?: string | null;
  currentRecordedAt?: string | null;
  currentCreatedAt?: string | null;
  speakerLabels?: {
    you: string;
    them: string;
  };
}

export interface RunActionLabels {
  noModel: string;
  actionFailed: string;
}

/**
 * Start processing an action on a note. Runs in the background — survives
 * component unmounts and navigation so the user can switch notes mid-action.
 */
export function runBackgroundAction(
  noteId: number,
  noteContent: string,
  contentHash: string,
  action: ActionItem,
  options: RunActionOptions,
  labels: RunActionLabels
): void {
  const operationId = makeNoteActionOperationId(noteId, action.id);
  if (processingFlags.get(noteId)) {
    logNoteAction(
      "NOTE_ACTION_SKIPPED_ALREADY_PROCESSING",
      {
        operationId,
        noteId,
        actionId: action.id,
        actionName: action.name,
      },
      "warn"
    );
    return;
  }

  const modelId = options.modelId;
  if (!modelId && !options.isCloudMode) {
    logNoteAction(
      "NOTE_ACTION_SKIPPED_NO_MODEL",
      {
        operationId,
        noteId,
        actionId: action.id,
        actionName: action.name,
        isCloudMode: options.isCloudMode,
      },
      "error"
    );
    pushErrorEvent({ noteId, message: labels.noModel });
    return;
  }

  logNoteAction("NOTE_ACTION_START", {
    operationId,
    noteId,
    actionId: action.id,
    actionName: action.name,
    outputTarget: action.output_target,
    writeMode: action.write_mode,
    modelId,
    isCloudMode: options.isCloudMode,
    currentTitle: options.currentTitle ?? null,
    noteContentLength: noteContent.length,
    contentHash,
    currentContentLength: String(options.currentContent ?? "").length,
    currentEnhancedContentLength: String(options.currentEnhancedContent ?? "").length,
    currentTranscriptLength: String(options.currentTranscript ?? "").length,
    currentRecordedAt: options.currentRecordedAt ?? null,
    currentCreatedAt: options.currentCreatedAt ?? null,
  });

  cancelledFlags.set(noteId, false);
  processingFlags.set(noteId, true);
  setNoteState(noteId, {
    status: "processing",
    actionName: action.name,
    outputTarget: action.output_target === "content" ? "content" : "enhanced_content",
  });

  (async () => {
    try {
      const { generatedContent, updates } = await runNoteActionOnce({
        noteId,
        note: {
          title: options.currentTitle ?? "",
          content: options.currentContent ?? noteContent,
          enhanced_content: options.currentEnhancedContent ?? null,
          transcript: options.currentTranscript ?? null,
          recorded_at: options.currentRecordedAt ?? null,
          created_at: options.currentCreatedAt ?? "",
        },
        action,
        modelId,
        isCloudMode: options.isCloudMode,
        operationId,
        speakerLabels: options.speakerLabels ?? { you: "You", them: "Them" },
      });

      if (cancelledFlags.get(noteId)) {
        logNoteAction(
          "NOTE_ACTION_CANCELLED_AFTER_MODEL_RESPONSE",
          {
            operationId,
            noteId,
            actionId: action.id,
            actionName: action.name,
            generatedContent: loggableText(generatedContent),
            updates,
          },
          "warn"
        );
        return;
      }

      logNoteAction("NOTE_ACTION_DB_UPDATE_START", {
        operationId,
        noteId,
        actionId: action.id,
        actionName: action.name,
        generatedContent: loggableText(generatedContent),
        updates,
      });
      const updateResult = await window.electronAPI.updateNote(noteId, updates);
      logNoteAction("NOTE_ACTION_DB_UPDATE_RESPONSE", {
        operationId,
        noteId,
        actionId: action.id,
        actionName: action.name,
        updateResult,
      });
      validateActionUpdateResult(updateResult, labels.actionFailed);

      setNoteState(noteId, { status: "success", actionName: action.name });
      logNoteAction("NOTE_ACTION_SUCCESS", {
        operationId,
        noteId,
        actionId: action.id,
        actionName: action.name,
      });

      const timer = setTimeout(() => {
        processingFlags.set(noteId, false);
        clearNoteState(noteId);
        successTimers.delete(noteId);
      }, 600);
      successTimers.set(noteId, timer);
    } catch (err) {
      if (cancelledFlags.get(noteId)) {
        logNoteAction(
          "NOTE_ACTION_CANCELLED_AFTER_ERROR",
          {
            operationId,
            noteId,
            actionId: action.id,
            actionName: action.name,
            error: err instanceof Error ? err.message : String(err),
          },
          "warn"
        );
        return;
      }
      processingFlags.set(noteId, false);
      clearNoteState(noteId);
      const message = err instanceof Error ? err.message : labels.actionFailed;
      logNoteAction(
        "NOTE_ACTION_ERROR",
        {
          operationId,
          noteId,
          actionId: action.id,
          actionName: action.name,
          error: message,
          stack: err instanceof Error ? err.stack : undefined,
        },
        "error"
      );
      pushErrorEvent({ noteId, message });
    } finally {
      cancelledFlags.delete(noteId);
    }
  })();
}

/** Soft cancel: the HTTP request continues but the result is discarded. */
export function cancelAction(noteId: number): void {
  cancelledFlags.set(noteId, true);
  processingFlags.set(noteId, false);
  const timer = successTimers.get(noteId);
  if (timer) {
    clearTimeout(timer);
    successTimers.delete(noteId);
  }
  clearNoteState(noteId);
}

export function consumeErrorEvents(): ActionErrorEvent[] {
  const { errorEvents } = useActionProcessingStore.getState();
  if (errorEvents.length === 0) return [];
  useActionProcessingStore.setState({ errorEvents: [] });
  return errorEvents;
}

export function selectNoteActionState(
  state: ActionProcessingStoreState,
  noteId: number | null
): NoteActionState {
  if (noteId == null) return IDLE_STATE;
  return state.noteStates[noteId] ?? IDLE_STATE;
}
