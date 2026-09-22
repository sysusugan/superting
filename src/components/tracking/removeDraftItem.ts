// Only edits the review payload; official items and the extraction snapshot stay intact.
export function removeDraftItem(draft: Record<string, unknown>, ref: string) {
  const result = { ...draft };
  for (const key of ["matchedItems", "newItems", "updates", "relations"]) {
    if (!Array.isArray(draft[key])) continue;
    result[key] = (draft[key] as Record<string, unknown>[]).filter((entry) =>
      key === "updates"
        ? entry.itemRef !== ref && entry.relatedItemRef !== ref
        : key === "relations"
          ? entry.sourceRef !== ref && entry.targetRef !== ref
          : entry.ref !== ref
    );
  }
  return result;
}
