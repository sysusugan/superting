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
import { modelRegistry } from "../models/ModelRegistry";
import {
  applyActionTitleDatePrefix,
  buildActionOutputUpdates,
  hasGeneratedActionContent,
  shouldGenerateTitleForExplicitAction,
  shouldUseChunkedActionInput,
  splitActionContentIntoChunks,
} from "./actionProcessingCore";

const LONG_ACTION_CONTENT_THRESHOLD = 36_000;
const LONG_ACTION_CHUNK_SIZE = 12_000;

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

interface PreparedActionContent {
  content: string;
  usedChunking: boolean;
}

function buildChunkSummaryPrompt(actionPrompt: string, chunkIndex: number, totalChunks: number) {
  return [
    "你是一名会议转写内容整理助手。",
    "当前输入是一段超长会议转写的其中一部分。请只基于本段内容提炼事实，不要补充未出现的信息。",
    "请保留关键议题、结论、待办、负责人、时间节点、风险和可用于最终会议纪要的细节。",
    "如果本段有时间戳，请保留时间线线索。",
    "输出要精炼但信息密度高，供后续合并成完整会议纪要。",
    "",
    `分段：${chunkIndex + 1}/${totalChunks}`,
    "",
    "最终用户动作要求如下，分段摘要应服务于该目标：",
    actionPrompt,
  ].join("\n");
}

function buildMergedSummaryInput(summaries: string[]) {
  return [
    "## 分段会议事实摘要",
    "",
    "以下内容来自同一场超长会议转写的分段事实摘要。请基于这些摘要完成用户要求的最终输出；不要编造摘要中没有的信息。",
    "",
    ...summaries.map((summary, index) => `### 分段 ${index + 1}\n${summary.trim()}`),
  ].join("\n\n");
}

function getLocalModelContextLength(modelId: string): number | undefined {
  return modelRegistry.getModel(modelId)?.model.contextLength;
}

function isLongActionRetryableError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("context") ||
    message.includes("token") ||
    message.includes("too large") ||
    message.includes("too long") ||
    message.includes("maximum")
  );
}

async function prepareActionContentForGeneration(
  content: string,
  actionPrompt: string,
  selectedModel: string,
  reasoningConfig: ReasoningConfig,
  options: { forceChunking?: boolean } = {}
): Promise<PreparedActionContent> {
  const contextLength = getLocalModelContextLength(selectedModel);
  const shouldChunk =
    options.forceChunking ||
    shouldUseChunkedActionInput({
      content,
      contextLength,
    });

  if (!shouldChunk) return { content, usedChunking: false };

  const chunks = splitActionContentIntoChunks(content, LONG_ACTION_CHUNK_SIZE);
  if (chunks.length <= 1) return { content, usedChunking: false };

  const summaries: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const summary = await reasoningService.processText(chunks[index], selectedModel, null, {
      ...reasoningConfig,
      systemPrompt: buildChunkSummaryPrompt(actionPrompt, index, chunks.length),
    });
    if (!hasGeneratedActionContent(summary)) {
      throw new Error(`Action generated empty summary for chunk ${index + 1}`);
    }
    summaries.push(summary.trim());
  }

  return { content: buildMergedSummaryInput(summaries), usedChunking: true };
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
    throw new Error("No AI model selected");
  }

  let generationInput = await prepareActionContentForGeneration(
    actionInput.content,
    action.prompt,
    selectedModel,
    reasoningConfig
  );

  let generatedContent: string;
  try {
    generatedContent = await reasoningService.processText(
      generationInput.content,
      selectedModel,
      null,
      reasoningConfig
    );
  } catch (error) {
    if (
      generationInput.usedChunking ||
      actionInput.content.length <= LONG_ACTION_CONTENT_THRESHOLD ||
      !isLongActionRetryableError(error)
    ) {
      throw error;
    }

    generationInput = await prepareActionContentForGeneration(
      actionInput.content,
      action.prompt,
      selectedModel,
      reasoningConfig,
      { forceChunking: true }
    );
    generatedContent = await reasoningService.processText(
      generationInput.content,
      selectedModel,
      null,
      reasoningConfig
    );
  }
  if (!hasGeneratedActionContent(generatedContent)) {
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

  if (shouldGenerateTitleForExplicitAction(note.title)) {
    const title = await generateNoteTitle(
      generatedContent,
      selectedModel,
      settings.customDictionary,
      settings.uiLanguage,
      reasoningConfig
    );
    if (title)
      updates.title = applyActionTitleDatePrefix(title, note.recorded_at || note.created_at);
  }

  return { generatedContent, updates };
}
