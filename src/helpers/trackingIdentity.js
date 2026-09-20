// Local references connect a draft's updates to its items; only persisted IDs identify items.
function normalizeTrackingDraft(input, existingItems) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.updates)) {
    throw new Error('Invalid tracking result');
  }
  const result = JSON.parse(JSON.stringify(input));
  const refs = new Set();
  let next = 0;
  for (const key of ['matchedItems', 'newItems']) {
    if (result[key] == null) result[key] = [];
    if (!Array.isArray(result[key])) throw new Error('Invalid tracking items');
    result[key] = result[key].map(item => {
      if (!item || typeof item.title !== 'string' || !item.title.trim() || typeof item.itemType !== 'string') {
        throw new Error('Every item requires a name and type');
      }
      while (refs.has(`new:${next + 1}`)) next++;
      const ref = item.ref || `new:${++next}`;
      if (typeof ref !== 'string' || refs.has(ref)) throw new Error('Duplicate or invalid item reference');
      refs.add(ref);
      let itemId = item.itemId;
      if (itemId == null && !item.createNew) {
        const matches = existingItems.filter(candidate => candidate.title === item.title && candidate.itemType === item.itemType);
        if (matches.length === 1) itemId = matches[0].id;
      }
      return { ...item, ref, itemId: itemId ?? null };
    });
  }
  const entries = [...result.matchedItems, ...result.newItems];
  const resolveLegacy = (title) => {
    const matches = entries.filter(item => item.title === title);
    if (matches.length !== 1) throw new Error('Ambiguous or missing item reference');
    return matches[0].ref;
  };
  const checkRef = ref => {
    if (typeof ref !== 'string' || !refs.has(ref)) throw new Error('Unknown item reference');
    return ref;
  };
  result.updates = result.updates.map(update => {
    if (!update || typeof update !== 'object') throw new Error('Invalid update');
    const owner = update.itemRef || resolveLegacy(update.itemTitle);
    const related = update.relatedItemRef || (update.relatedItemTitle ? resolveLegacy(update.relatedItemTitle) : null);
    return { ...update, itemRef: checkRef(owner), relatedItemRef: related ? checkRef(related) : null };
  });
  if (result.relations != null && !Array.isArray(result.relations)) throw new Error('Invalid relations');
  for (const relation of result.relations || []) {
    checkRef(relation.sourceRef);
    checkRef(relation.targetRef);
    if (typeof relation.relationType !== 'string' || !relation.relationType.trim() ||
        typeof relation.evidence !== 'string' || !relation.evidence.trim()) throw new Error('Relation requires type and evidence');
  }
  return result;
}

module.exports = { normalizeTrackingDraft };
