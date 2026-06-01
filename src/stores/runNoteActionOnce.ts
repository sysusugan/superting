import reasoningService from "../services/ReasoningService";
import type { ActionItem, NoteItem } from "../types/electron";
import { getSettings } from "./settingsStore";
import { buildNoteActionSystemPrompt } from "./noteActionPrompt";
import { generateNoteTitle } from "../utils/generateTitle";
import { buildNoteActionInput } from "../components/notes/noteActionInput";
import { buildActionOutputUpdates, shouldAutoGenerateActionTitle } from "./actionProcessingCore";

interface RunNoteActionOnceInput {
  note: Pick<NoteItem, "title" | "content" | "enhanced_content" | "transcript">;
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
  if (!modelId && !isCloudMode) {
    throw new Error("No AI model selected");
  }

  const actionInput = buildNoteActionInput({
    noteContent: note.content,
    rawTranscript: note.transcript,
    speakerLabels,
  });
  if (!actionInput) {
    throw new Error("No note content or transcript available");
  }

  const settings = getSettings();
  const systemPrompt = buildNoteActionSystemPrompt(action.prompt, {
    isMeetingNote: actionInput.isMeetingNote,
    customDictionary: settings.customDictionary,
    uiLanguage: settings.uiLanguage,
  });

  const generatedContent = await reasoningService.processText(actionInput.content, modelId, null, {
    systemPrompt,
    temperature: 0.3,
    disableThinking: settings.noteFormattingDisableThinking,
  });

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
      modelId,
      settings.customDictionary,
      settings.uiLanguage
    );
    if (title) updates.title = title;
  }

  return { generatedContent, updates };
}
