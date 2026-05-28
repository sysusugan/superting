import reasoningService from "../services/ReasoningService";
import { getSettings } from "../stores/settingsStore";
import { buildTitleSystemPrompt } from "./generateTitlePrompt";

export async function generateNoteTitle(
  text: string,
  modelId: string,
  customDictionary?: string[],
  uiLanguage?: string
): Promise<string> {
  try {
    const raw = await reasoningService.processText(text.slice(0, 2000), modelId, null, {
      systemPrompt: buildTitleSystemPrompt(customDictionary, uiLanguage),
      temperature: 0.3,
      disableThinking: getSettings().noteFormattingDisableThinking,
    });
    const cleaned = raw.trim().replace(/^["']|["']$/g, "");
    return cleaned.length > 0 && cleaned.length < 100 ? cleaned : "";
  } catch {
    return "";
  }
}
