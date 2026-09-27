export type ReviewDraftItem = {
  ref: string;
  itemId?: number | null;
  createNew?: boolean;
};

export function assignReviewDraftItem(
  draft: Record<string, unknown>,
  ref: string,
  selectedId?: number
) {
  const result = structuredClone(draft);
  for (const key of ["matchedItems", "newItems"])
    for (const item of (result[key] || []) as ReviewDraftItem[])
      if (item.ref === ref) {
        item.createNew = selectedId == null ? item.createNew !== true : false;
        item.itemId = selectedId ?? null;
      }
  return result;
}
