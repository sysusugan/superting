const DEFAULT_DICTIONARY_INSTRUCTION =
  "Custom Dictionary: These are user-defined proper nouns, product names, project names, company names, people, or technical terms. When processing ASR text, notes, summaries, or titles, correct likely homophones, near matches, casing differences, and speech-recognition errors to these exact spellings. Do not translate, rewrite, split, or expand these dictionary terms. Do not insert a term if it is not supported by the surrounding context: ";

export function normalizeDictionaryWords(words) {
  if (!words?.length) return [];
  const seen = new Set();
  const normalized = [];
  for (const word of words) {
    const trimmed = String(word).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function buildDictionaryPrompt(words) {
  const normalized = normalizeDictionaryWords(words);
  return normalized.length > 0 ? normalized.join(", ") : null;
}

export function buildDictionaryInstruction(words) {
  const prompt = buildDictionaryPrompt(words);
  return prompt ? DEFAULT_DICTIONARY_INSTRUCTION + prompt : "";
}
