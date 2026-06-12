import type { TranscriptionItem } from "../types/electron";

export interface DictionaryCorrectionRecord {
  from: string;
  to: string;
  kind?: string;
}

export interface CleanupErrorRecord {
  message: string;
  code?: string;
  provider?: string;
  model?: string;
  stage?: string;
}

export interface VoiceFlowMetadata {
  mode?: string | null;
  provider?: string | null;
  model?: string | null;
  language?: string | null;
  rawText?: string | null;
  refinedText?: string | null;
  displayText?: string | null;
  warning?: string | null;
  dictionaryCorrections?: DictionaryCorrectionRecord[];
  cleanupError?: CleanupErrorRecord;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeCorrection(value: unknown): DictionaryCorrectionRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const from = typeof record.from === "string" ? record.from.trim() : "";
  const to = typeof record.to === "string" ? record.to.trim() : "";
  if (!from || !to) return null;
  return {
    from,
    to,
    kind: typeof record.kind === "string" ? record.kind : undefined,
  };
}

function normalizeCleanupError(value: unknown): CleanupErrorRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) return null;
  return {
    message,
    code: typeof record.code === "string" ? record.code : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    stage: typeof record.stage === "string" ? record.stage : undefined,
  };
}

export function getVoiceFlowMetadata(item: TranscriptionItem): VoiceFlowMetadata | null {
  const metadata = parseMetadata(item.processing_metadata);
  const voiceFlow = metadata?.voiceFlow;
  if (!voiceFlow || typeof voiceFlow !== "object") return null;
  const normalized = voiceFlow as VoiceFlowMetadata;
  const cleanupError = normalizeCleanupError(normalized.cleanupError);
  return cleanupError
    ? { ...normalized, cleanupError }
    : { ...normalized, cleanupError: undefined };
}

export function getDictionaryCorrections(item: TranscriptionItem): DictionaryCorrectionRecord[] {
  const corrections = getVoiceFlowMetadata(item)?.dictionaryCorrections;
  if (!Array.isArray(corrections)) return [];
  return corrections.map(normalizeCorrection).filter(Boolean) as DictionaryCorrectionRecord[];
}

export function getCleanupError(item: TranscriptionItem): CleanupErrorRecord | null {
  return getVoiceFlowMetadata(item)?.cleanupError ?? null;
}
