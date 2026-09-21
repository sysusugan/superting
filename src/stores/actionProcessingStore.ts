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

export interface ActionRunResult {
  status: "draft" | "reused" | "skipped" | "busy" | "failed" | "cancelled";
  error?: string;
  extraction?: Record<string, unknown>;
}
export interface BatchEntry {
  id: number;
  title: string;
  status: "queued" | "processing" | ActionRunResult["status"];
  error?: string;
}
interface ActionProcessingStoreState {
  trackingErrors: Record<number, string>;
  batch: { running: boolean; stopped: boolean; entries: BatchEntry[] };
  noteStates: Record<number, NoteActionState>;
  errorEvents: ActionErrorEvent[];
}

const cancelledFlags = new Map<number, boolean>();
const processingFlags = new Map<number, boolean>();
export function beginChatNoteAction(noteId: number): boolean {
  if (processingFlags.get(noteId)) return false;
  processingFlags.set(noteId, true);
  return true;
}
export function endChatNoteAction(noteId: number): void {
  processingFlags.set(noteId, false);
}
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
  trackingErrors: {},
  batch: { running: false, stopped: false, entries: [] },
  noteStates: {},
  errorEvents: [],
}));

export interface RunActionOptions {
  forceTracking?: boolean;
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
export async function runBackgroundAction(
  noteId: number,
  noteContent: string,
  contentHash: string,
  action: ActionItem,
  options: RunActionOptions,
  labels: RunActionLabels
): Promise<ActionRunResult> {
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
    return { status: "busy" };
  }

  const modelId = options.modelId;
  if (action.output_target === "tracking") {
    const errors = { ...useActionProcessingStore.getState().trackingErrors };
    delete errors[noteId];
    useActionProcessingStore.setState({ trackingErrors: errors });
  }
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
    if (action.output_target === "tracking")
      useActionProcessingStore.setState((state) => ({
        trackingErrors: { ...state.trackingErrors, [noteId]: labels.noModel },
      }));
    return { status: "failed", error: labels.noModel };
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

  const previousTimer = successTimers.get(noteId);
  if (previousTimer) clearTimeout(previousTimer);
  successTimers.delete(noteId);
  cancelledFlags.set(noteId, false);
  processingFlags.set(noteId, true);
  setNoteState(noteId, {
    status: "processing",
    actionName: action.name,
    outputTarget: action.output_target,
  });

  return await (async (): Promise<ActionRunResult> => {
    try {
      if (action.output_target === "tracking" && !options.forceTracking) {
        const cached = await window.electronAPI.getTrackingExtraction(noteId, action.id);
        if ((cached?.result as { protocolVersion?: number } | undefined)?.protocolVersion === 2) {
          window.dispatchEvent(new CustomEvent("superting-tracking-updated", { detail: noteId }));
          setNoteState(noteId, { status: "success", actionName: action.name });
          const timer = setTimeout(() => {
            clearNoteState(noteId);
            successTimers.delete(noteId);
          }, 600);
          successTimers.set(noteId, timer);
          return {
            status: cached.status === "confirmed" ? "skipped" : "reused",
            extraction: cached,
          };
        }
      }
      const { generatedContent, updates, inputHash } = await runNoteActionOnce({
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
        return { status: "cancelled" };
      }

      let savedExtraction: Record<string, unknown> | undefined;
      if (action.output_target === "tracking") {
        const extractionResult = await window.electronAPI.saveTrackingExtraction(
          noteId,
          action.id,
          generatedContent,
          options.forceTracking === true,
          inputHash
        );
        if (!extractionResult?.success) {
          throw new Error(extractionResult?.error || labels.actionFailed);
        }
        savedExtraction = extractionResult.extraction;
        window.dispatchEvent(new CustomEvent("superting-tracking-updated", { detail: noteId }));
      } else {
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
      }

      setNoteState(noteId, { status: "success", actionName: action.name });
      logNoteAction("NOTE_ACTION_SUCCESS", {
        operationId,
        noteId,
        actionId: action.id,
        actionName: action.name,
      });

      const timer = setTimeout(() => {
        clearNoteState(noteId);
        successTimers.delete(noteId);
      }, 600);
      successTimers.set(noteId, timer);
      return { status: "draft", extraction: savedExtraction };
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
        return { status: "cancelled" };
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
      if (action.output_target === "tracking")
        useActionProcessingStore.setState((state) => ({
          trackingErrors: { ...state.trackingErrors, [noteId]: message },
        }));
      return { status: "failed", error: message };
    } finally {
      processingFlags.set(noteId, false);
      cancelledFlags.delete(noteId);
    }
  })();
}

/** Soft cancel: the HTTP request continues but the result is discarded. */
export function cancelAction(noteId: number): void {
  cancelledFlags.set(noteId, true);
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

export function stopTrackingBatch() {
  const batch = useActionProcessingStore.getState().batch;
  useActionProcessingStore.setState({ batch: { ...batch, stopped: true } });
}
export async function runTrackingBatch(
  notes: { id: number; title: string }[],
  action: ActionItem,
  options: RunActionOptions,
  labels: RunActionLabels
) {
  if (useActionProcessingStore.getState().batch.running) return;
  const entries: BatchEntry[] = notes.map((n) => ({ ...n, status: "queued" }));
  const publish = (running = true) =>
    useActionProcessingStore.setState({
      batch: {
        ...useActionProcessingStore.getState().batch,
        running,
        entries: entries.map((e) => ({ ...e })),
      },
    });
  useActionProcessingStore.setState({ batch: { running: true, stopped: false, entries } });
  try {
    for (const entry of entries) {
      if (useActionProcessingStore.getState().batch.stopped) break;
      entry.status = "processing";
      publish();
      const result = await runBackgroundAction(entry.id, "", "", action, options, labels);
      entry.status = result.status;
      entry.error = result.error;
      publish();
    }
  } finally {
    for (const entry of entries) if (entry.status === "queued") entry.status = "cancelled";
    publish(false);
  }
}
