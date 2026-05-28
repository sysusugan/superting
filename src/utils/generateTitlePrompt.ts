import { buildDictionaryInstruction } from "../config/dictionaryPrompt.js";

const TITLE_SYSTEM_PROMPT =
  "Generate a concise 3-8 word title for these notes. Return ONLY the title text, nothing else — no quotes, no prefix, no explanation.";

export function buildTitleSystemPrompt(customDictionary?: string[], _uiLanguage?: string): string {
  const dictionaryInstruction = buildDictionaryInstruction(customDictionary);
  return dictionaryInstruction
    ? `${TITLE_SYSTEM_PROMPT}\n\n${dictionaryInstruction}`
    : TITLE_SYSTEM_PROMPT;
}
