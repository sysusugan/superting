export interface MarkdownImageInsertInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  src: string;
  alt?: string;
}

export interface MarkdownReplaceRequest {
  mode: "current" | "all";
  query: string;
  replacement: string;
  activeIndex: number;
  ignoreCase: boolean;
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMatches(
  value: string,
  query: string,
  ignoreCase: boolean
): Array<{ index: number; length: number }> {
  if (!query) return [];
  const pattern = new RegExp(escapeRegExp(query), ignoreCase ? "gi" : "g");
  return Array.from(value.matchAll(pattern), (match) => ({
    index: match.index ?? 0,
    length: match[0].length,
  }));
}

export function insertMarkdownImageReference(input: MarkdownImageInsertInput): {
  value: string;
  selection: { start: number; end: number };
} {
  const value = String(input.value || "");
  const image = `![${escapeMarkdownImageAlt(input.alt || "")}](${input.src})`;
  const hasSelection =
    input.selectionStart >= 0 &&
    input.selectionEnd >= input.selectionStart &&
    input.selectionStart <= value.length &&
    input.selectionEnd <= value.length;

  if (!hasSelection) {
    const separator = value.length > 0 ? "\n\n" : "";
    const nextValue = `${value}${separator}${image}`;
    return {
      value: nextValue,
      selection: { start: nextValue.length, end: nextValue.length },
    };
  }

  const nextValue = `${value.slice(0, input.selectionStart)}${image}${value.slice(
    input.selectionEnd
  )}`;
  const cursor = input.selectionStart + image.length;
  return {
    value: nextValue,
    selection: { start: cursor, end: cursor },
  };
}

export function applyMarkdownReplaceRequest(
  value: string,
  request: MarkdownReplaceRequest
): { value: string; replaced: number } {
  if (!request.query) return { value, replaced: 0 };

  if (request.mode === "all") {
    const matches = getMatches(value, request.query, request.ignoreCase);
    const pattern = new RegExp(escapeRegExp(request.query), request.ignoreCase ? "gi" : "g");
    return {
      value: value.replace(pattern, request.replacement),
      replaced: matches.length,
    };
  }

  const match = getMatches(value, request.query, request.ignoreCase)[request.activeIndex];
  if (!match) return { value, replaced: 0 };
  return {
    value: `${value.slice(0, match.index)}${request.replacement}${value.slice(
      match.index + match.length
    )}`,
    replaced: 1,
  };
}
