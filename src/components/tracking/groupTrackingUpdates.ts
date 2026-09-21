/** Stable grouping by persisted identity or draft ref. Never infer ownership from titles. */
export function groupTrackingUpdates<I, U>(
  items: I[],
  updates: U[],
  itemKey: (item: I) => string | number | undefined,
  updateKey: (update: U) => string | number | undefined
) {
  const groups = items.map((item) => ({ item, updates: [] as U[] }));
  const byKey = new Map<string | number, (typeof groups)[number]>();
  for (const group of groups) {
    const key = itemKey(group.item);
    if (key !== undefined && !byKey.has(key)) byKey.set(key, group);
  }
  const unassigned: U[] = [];
  for (const update of updates) {
    const key = updateKey(update);
    (key !== undefined ? (byKey.get(key)?.updates ?? unassigned) : unassigned).push(update);
  }
  return { groups, unassigned };
}
