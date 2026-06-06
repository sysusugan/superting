import type { TranscriptionItem } from "../types/electron";

export interface DictionaryCorrectionRecord {
  from: string;
  to: string;
  kind?: string;
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

export function getVoiceFlowMetadata(item: TranscriptionItem): VoiceFlowMetadata | null {
  const metadata = parseMetadata(item.processing_metadata);
  const voiceFlow = metadata?.voiceFlow;
  if (!voiceFlow || typeof voiceFlow !== "object") return null;
  return voiceFlow as VoiceFlowMetadata;
}

export function getDictionaryCorrections(item: TranscriptionItem): DictionaryCorrectionRecord[] {
  const corrections = getVoiceFlowMetadata(item)?.dictionaryCorrections;
  if (!Array.isArray(corrections)) return [];
  return corrections.map(normalizeCorrection).filter(Boolean) as DictionaryCorrectionRecord[];
}
