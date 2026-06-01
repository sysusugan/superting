interface CurrentPageFindOptions {
  ignoreCase?: boolean;
}

export interface FindMatch {
  index: number;
  length: number;
}

export interface SegmentFindMatch {
  segmentId: string;
  segmentIndex: number;
  localMatchIndex: number;
  segmentMatchStartIndex: number;
  segmentMatchCount: number;
}

export interface FindMatchPreview {
  before: string;
  match: string;
  after: string;
  hasLeadingEllipsis: boolean;
  hasTrailingEllipsis: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function makeCurrentPageFindPattern(
  query: string,
  options: CurrentPageFindOptions = {}
): RegExp | null {
  if (!query) return null;
  return new RegExp(escapeRegExp(query), options.ignoreCase === false ? "g" : "gi");
}

export function getFindMatches(
  content: string,
  query: string,
  options: CurrentPageFindOptions = {}
): FindMatch[] {
  const pattern = makeCurrentPageFindPattern(query, options);
  if (!pattern) return [];
  return Array.from(content.matchAll(pattern), (match) => ({
    index: match.index ?? 0,
    length: match[0].length,
  }));
}

export function countFindMatches(
  content: string,
  query: string,
  options: CurrentPageFindOptions = {}
): number {
  return getFindMatches(content, query, options).length;
}

export function replaceFindMatchAt(
  content: string,
  query: string,
  replacement: string,
  matchIndex: number,
  options: CurrentPageFindOptions = {}
): string {
  const match = getFindMatches(content, query, options)[matchIndex];
  if (!match) return content;
  return `${content.slice(0, match.index)}${replacement}${content.slice(match.index + match.length)}`;
}

export function replaceAllFindMatches(
  content: string,
  query: string,
  replacement: string,
  options: CurrentPageFindOptions = {}
): string {
  const pattern = makeCurrentPageFindPattern(query, options);
  if (!pattern) return content;
  return content.replace(pattern, replacement);
}

export function getNextFindIndex(
  currentIndex: number,
  totalMatches: number,
  direction: 1 | -1
): number {
  if (totalMatches <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= totalMatches) {
    return direction > 0 ? 0 : totalMatches - 1;
  }
  return (currentIndex + direction + totalMatches) % totalMatches;
}

export function getActiveSegmentFindMatch(
  segments: Array<{ id: string; text: string }>,
  query: string,
  activeIndex: number,
  options: CurrentPageFindOptions = {}
): SegmentFindMatch | null {
  if (!query || activeIndex < 0) return null;

  let running = 0;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const segmentMatchCount = countFindMatches(segment.text, query, options);
    if (activeIndex < running + segmentMatchCount) {
      return {
        segmentId: segment.id,
        segmentIndex,
        localMatchIndex: activeIndex - running,
        segmentMatchStartIndex: running,
        segmentMatchCount,
      };
    }
    running += segmentMatchCount;
  }

  return null;
}

export function getFindMatchPreview(
  content: string,
  query: string,
  matchIndex: number,
  contextChars = 28,
  options: CurrentPageFindOptions = {}
): FindMatchPreview | null {
  const match = getFindMatches(content, query, options)[matchIndex];
  if (!match) return null;

  const contextSize = Math.max(0, contextChars);
  const beforeStart = Math.max(0, match.index - contextSize);
  const afterEnd = Math.min(content.length, match.index + match.length + contextSize);
  const hasLeadingEllipsis = beforeStart > 0;
  const hasTrailingEllipsis = afterEnd < content.length;

  let before = content.slice(beforeStart, match.index);
  if (hasLeadingEllipsis) {
    before = before.replace(/^[^\s]+/, "").replace(/^\s+/, "");
  }

  return {
    before,
    match: content.slice(match.index, match.index + match.length),
    after: content.slice(match.index + match.length, afterEnd),
    hasLeadingEllipsis,
    hasTrailingEllipsis,
  };
}
