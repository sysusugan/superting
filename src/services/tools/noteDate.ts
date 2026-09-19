import { normalizeDbDate } from "../../utils/dateFormatting";

export function formatNoteToolDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? new Date(value) : normalizeDbDate(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
