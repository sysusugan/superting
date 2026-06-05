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
  shouldAutoGenerateActionTitle,
} from "./actionProcessingCore";

interface RunNoteActionOnceInput {
  note: Pick<
    NoteItem,
    "title" | "content" | "enhanced_content" | "transcript" | "recorded_at" | "created_at"
  >;
  action: ActionItem;
  modelId: string;
  isCloudMode: boolean;
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
  note,
  action,
  modelId,
  isCloudMode,
  speakerLabels,
}: RunNoteActionOnceInput): Promise<RunNoteActionOnceResult> {
  const actionInput = buildNoteActionInput({
    noteContent: note.content,
    rawTranscript: note.transcript,
    speakerLabels,
  });
  if (!actionInput) {
    throw new Error("No note content or transcript available");
  }

  const settings = getSettings();
  const resolvedFormatting = selectResolvedNoteFormatting(settings);
  const isOpenWhisprCloud = isCloudMode || selectIsCloudNoteFormattingMode(settings);
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

  if (isOpenWhisprCloud) {
    reasoningConfig.provider = "openwhispr";
  } else if (resolvedFormatting.mode === "self-hosted" && resolvedFormatting.remoteUrl) {
    reasoningConfig.lanUrl = resolvedFormatting.remoteUrl;
  } else if (resolvedFormatting.mode === "providers" || resolvedFormatting.mode === "enterprise") {
    reasoningConfig.provider = resolvedFormatting.provider || undefined;
  }

  if (resolvedFormatting.provider === "custom") {
    reasoningConfig.baseUrl = resolvedFormatting.cloudBaseUrl;
    reasoningConfig.customApiKey = settings.noteFormattingCustomApiKey;
  }

  if (!selectedModel && !isOpenWhisprCloud && !reasoningConfig.lanUrl) {
    throw new Error("No AI model selected");
  }

  const generatedContent = await reasoningService.processText(
    actionInput.content,
    selectedModel,
    null,
    reasoningConfig
  );

  const updates = buildActionOutputUpdates({
    outputTarget: action.output_target,
    writeMode: action.write_mode,
    generatedContent,
    existingContent: note.content,
    existingEnhancedContent: note.enhanced_content,
    actionPrompt: action.prompt,
    contentHash: actionInput.contentHash,
  });

  if (settings.autoGenerateNoteTitle && shouldAutoGenerateActionTitle(note.title)) {
    const title = await generateNoteTitle(
      generatedContent,
      selectedModel,
      settings.customDictionary,
      settings.uiLanguage,
      reasoningConfig
    );
    if (title) updates.title = applyActionTitleDatePrefix(title, note.recorded_at || note.created_at);
  }

  return { generatedContent, updates };
}
