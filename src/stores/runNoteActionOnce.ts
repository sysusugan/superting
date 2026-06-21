import reasoningService from "../services/ReasoningService";
import type { ReasoningConfig } from "../services/BaseReasoningService";
import type { ActionItem, NoteItem } from "../types/electron";
import {
  getSettings,
  selectIsCloudNoteFormattingMode,
  selectResolvedNoteFormatting,
} from "./settingsStore";
import { buildNoteActionSystemPrompt } from "./noteActionPrompt";
import { generateNoteTitle } from "../utils/generateTitle";
import { buildNoteActionInput } from "../components/notes/noteActionInput";
import {
  applyActionTitleDatePrefix,
  buildActionOutputUpdates,
  hasGeneratedActionContent,
  shouldGenerateTitleForExplicitAction,
} from "./actionProcessingCore";
import { loggableText, logNoteAction, makeNoteActionOperationId } from "./noteActionLogger";

interface RunNoteActionOnceInput {
  noteId?: number;
  note: Pick<
    NoteItem,
    "title" | "content" | "enhanced_content" | "transcript" | "recorded_at" | "created_at"
  >;
  action: ActionItem;
  modelId: string;
  isCloudMode: boolean;
  operationId?: string;
  speakerLabels: {
    you: string;
    them: string;
  };
}

export interface RunNoteActionOnceResult {
  generatedContent: string;
  updates: Record<string, string | null>;
}

export async function runNoteActionOnce({
  noteId,
  note,
  action,
  modelId,
  isCloudMode,
  operationId,
  speakerLabels,
}: RunNoteActionOnceInput): Promise<RunNoteActionOnceResult> {
  const effectiveNoteId = noteId ?? -1;
  const effectiveOperationId =
    operationId ?? makeNoteActionOperationId(effectiveNoteId, action.id);
  const actionInput = buildNoteActionInput({
    noteContent: note.content,
    rawTranscript: note.transcript,
    speakerLabels,
  });
  if (!actionInput) {
    logNoteAction(
      "NOTE_ACTION_INPUT_EMPTY",
      {
        operationId: effectiveOperationId,
        noteId: effectiveNoteId,
        actionId: action.id,
        actionName: action.name,
        noteContentLength: String(note.content ?? "").length,
        transcriptLength: String(note.transcript ?? "").length,
      },
      "warn"
    );
    throw new Error("No note content or transcript available");
  }

  const settings = getSettings();
  const resolvedFormatting = selectResolvedNoteFormatting(settings);
  const isHostedMode = isCloudMode || selectIsCloudNoteFormattingMode(settings);
  const selectedModel = modelId || resolvedFormatting.model;
  const systemPrompt = buildNoteActionSystemPrompt(action.prompt, {
    isMeetingNote: actionInput.isMeetingNote,
    customDictionary: settings.customDictionary,
    uiLanguage: settings.uiLanguage,
  });

  const reasoningConfig: ReasoningConfig = {
    systemPrompt,
    temperature: 0.3,
    disableThinking: settings.noteFormattingDisableThinking,
  };

  if (isHostedMode) {
    throw new Error("Hosted note actions are not available in this build.");
  } else if (resolvedFormatting.mode === "self-hosted" && resolvedFormatting.remoteUrl) {
    reasoningConfig.lanUrl = resolvedFormatting.remoteUrl;
  } else if (resolvedFormatting.mode === "providers" || resolvedFormatting.mode === "enterprise") {
    reasoningConfig.provider = resolvedFormatting.provider || undefined;
  }

  if (resolvedFormatting.provider === "custom") {
    reasoningConfig.baseUrl = resolvedFormatting.cloudBaseUrl;
    reasoningConfig.customApiKey = settings.noteFormattingCustomApiKey;
  }

  if (!selectedModel && !reasoningConfig.lanUrl) {
    logNoteAction(
      "NOTE_ACTION_NO_MODEL",
      {
        operationId: effectiveOperationId,
        noteId: effectiveNoteId,
        actionId: action.id,
        actionName: action.name,
        resolvedMode: resolvedFormatting.mode,
        provider: resolvedFormatting.provider || null,
      },
      "error"
    );
    throw new Error("No AI model selected");
  }

  logNoteAction("NOTE_ACTION_MODEL_REQUEST", {
    operationId: effectiveOperationId,
    noteId: effectiveNoteId,
    actionId: action.id,
    actionName: action.name,
    outputTarget: action.output_target,
    writeMode: action.write_mode,
    selectedModel,
    resolvedMode: resolvedFormatting.mode,
    provider: resolvedFormatting.provider || null,
    isCloudMode,
    isHostedMode,
    isMeetingNote: actionInput.isMeetingNote,
    contentHash: actionInput.contentHash,
    actionInputLength: actionInput.content.length,
    noteContentLength: String(note.content ?? "").length,
    transcriptLength: String(note.transcript ?? "").length,
    enhancedContentLength: String(note.enhanced_content ?? "").length,
    systemPromptLength: systemPrompt.length,
    actionPrompt: action.prompt,
  });

  const generatedContent = await reasoningService.processText(
    actionInput.content,
    selectedModel,
    null,
    reasoningConfig
  );
  logNoteAction("NOTE_ACTION_MODEL_RESPONSE", {
    operationId: effectiveOperationId,
    noteId: effectiveNoteId,
    actionId: action.id,
    actionName: action.name,
    selectedModel,
    generatedContent: loggableText(generatedContent),
  });
  if (!hasGeneratedActionContent(generatedContent)) {
    logNoteAction(
      "NOTE_ACTION_EMPTY_RESPONSE",
      {
        operationId: effectiveOperationId,
        noteId: effectiveNoteId,
        actionId: action.id,
        actionName: action.name,
        selectedModel,
        generatedContent: loggableText(generatedContent),
      },
      "error"
    );
    throw new Error("Action generated empty content");
  }

  const updates = buildActionOutputUpdates({
    outputTarget: action.output_target,
    writeMode: action.write_mode,
    generatedContent,
    existingContent: note.content,
    existingEnhancedContent: note.enhanced_content,
    actionPrompt: action.prompt,
    contentHash: actionInput.contentHash,
  });
  logNoteAction("NOTE_ACTION_UPDATE_PAYLOAD", {
    operationId: effectiveOperationId,
    noteId: effectiveNoteId,
    actionId: action.id,
    actionName: action.name,
    updates,
  });

  if (shouldGenerateTitleForExplicitAction(note.title)) {
    logNoteAction("NOTE_ACTION_TITLE_REQUEST", {
      operationId: effectiveOperationId,
      noteId: effectiveNoteId,
      actionId: action.id,
      actionName: action.name,
      selectedModel,
      generatedContentLength: generatedContent.length,
    });
    const title = await generateNoteTitle(
      generatedContent,
      selectedModel,
      settings.customDictionary,
      settings.uiLanguage,
      reasoningConfig
    );
    logNoteAction("NOTE_ACTION_TITLE_RESPONSE", {
      operationId: effectiveOperationId,
      noteId: effectiveNoteId,
      actionId: action.id,
      actionName: action.name,
      title,
    });
    if (title)
      updates.title = applyActionTitleDatePrefix(title, note.recorded_at || note.created_at);
  }

  logNoteAction("NOTE_ACTION_RESULT", {
    operationId: effectiveOperationId,
    noteId: effectiveNoteId,
    actionId: action.id,
    actionName: action.name,
    generatedContent: loggableText(generatedContent),
    updates,
  });

  return { generatedContent, updates };
}
