interface CurrentPageFindOptions {
  ignoreCase?: boolean;
}

export interface FindMatch {
  index: number;
  length: number;
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
