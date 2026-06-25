export interface DictionaryAliasInput {
  from: string;
  to: string;
}

export type DictionaryDisplayItem =
  | {
      type: "word";
      id: string;
      word: string;
      searchableText: string;
    }
  | {
      type: "alias";
      id: string;
      from: string;
      to: string;
      searchableText: string;
    };

interface BuildDictionaryDisplayItemsOptions {
  dictionary: string[];
  aliases: DictionaryAliasInput[];
}

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const buildWordItem = (word: string): DictionaryDisplayItem => ({
  type: "word",
  id: `word:${word}`,
  word,
  searchableText: normalizeSearch(word),
});

const buildAliasItem = (alias: DictionaryAliasInput): DictionaryDisplayItem => {
  const from = alias.from.trim();
  const to = alias.to.trim();

  return {
    type: "alias",
    id: `alias:${from}->${to}`,
    from,
    to,
    searchableText: normalizeSearch(`${from} ${to}`),
  };
};

export function buildDictionaryDisplayItems({
  dictionary,
  aliases,
}: BuildDictionaryDisplayItemsOptions): DictionaryDisplayItem[] {
  const normalizedWords = dictionary.map((word) => word.trim()).filter(Boolean);
  const aliasesByTarget = new Map<string, DictionaryDisplayItem[]>();
  const orphanAliases: DictionaryDisplayItem[] = [];
  const dictionaryTargets = new Set(normalizedWords.map((word) => normalizeSearch(word)));

  for (const alias of aliases) {
    const from = alias.from.trim();
    const to = alias.to.trim();
    if (!from || !to) continue;

    const aliasItem = buildAliasItem({ from, to });
    const targetKey = normalizeSearch(to);
    if (!dictionaryTargets.has(targetKey)) {
      orphanAliases.push(aliasItem);
      continue;
    }

    const targetAliases = aliasesByTarget.get(targetKey) || [];
    targetAliases.push(aliasItem);
    aliasesByTarget.set(targetKey, targetAliases);
  }

  const items: DictionaryDisplayItem[] = [];
  for (const word of normalizedWords) {
    items.push(buildWordItem(word));
    items.push(...(aliasesByTarget.get(normalizeSearch(word)) || []));
  }
  items.push(...orphanAliases);

  return items;
}

export function filterDictionaryDisplayItems(
  items: DictionaryDisplayItem[],
  query: string
): DictionaryDisplayItem[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return items;

  return items.filter((item) => item.searchableText.includes(normalizedQuery));
}
