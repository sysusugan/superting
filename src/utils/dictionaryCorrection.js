function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function normalizeDictionaryAliases(aliases = [], dictionary = []) {
  const dictionaryByKey = new Map();
  for (const word of dictionary) {
    const normalized = normalizeText(word);
    if (normalized) dictionaryByKey.set(normalized.toLowerCase(), normalized);
  }

  const seen = new Set();
  const normalizedAliases = [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const from = normalizeText(alias?.from);
    const toKey = normalizeText(alias?.to).toLowerCase();
    const to = dictionaryByKey.get(toKey);
    if (!from || !to) continue;
    if (from.toLowerCase() === to.toLowerCase()) continue;

    const key = `${from.toLowerCase()}->${to.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedAliases.push({ from, to });
  }
  return normalizedAliases;
}

function normalizeDictionary(dictionary = []) {
  const seen = new Set();
  const words = [];
  for (const word of Array.isArray(dictionary) ? dictionary : []) {
    const normalized = normalizeText(word);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(normalized);
  }
  return words;
}

function isAsciiTerm(value) {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

const COMMON_WORD_DENYLIST = new Set([
  "universe",
  "universal",
  "reverse",
  "inverse",
  "service",
  "server",
]);

function isLikelyDictionaryMiss(candidate, target) {
  const source = normalizeKey(candidate);
  const desired = normalizeKey(target);
  if (!source || !desired || source === desired) return false;
  if (!isAsciiTerm(candidate) || !isAsciiTerm(target)) return false;
  if (COMMON_WORD_DENYLIST.has(source)) return false;

  const maxLength = Math.max(source.length, desired.length);
  if (maxLength < 4 || Math.abs(source.length - desired.length) > 3) return false;

  const distance = editDistance(source, desired);
  const ratio = distance / maxLength;
  if (ratio <= 0.34) return true;

  const startsLikeEnt = /^[ae]nt/.test(source) && /^ent/.test(desired);
  if (startsLikeEnt && ratio <= 0.65) return true;

  return false;
}

let chineseWordSegmenter;

function replaceWholeTerm(text, from, to, kind, replacements) {
  const isChineseAlias = kind === "alias" && /\p{Script=Han}/u.test(from);
  let boundaries;
  if (isChineseAlias) {
    chineseWordSegmenter ??= new Intl.Segmenter("zh-CN", { granularity: "word" });
    // Match whole spans, including multi-word aliases, without cutting compound words.
    boundaries = new Set([text.length]);
    for (const { index } of chineseWordSegmenter.segment(text)) boundaries.add(index);
  }
  const pattern = isChineseAlias
    ? new RegExp(escapeRegExp(from), "giu")
    : new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(from)}(?![\\p{L}\\p{N}_])`, "giu");
  return text.replace(pattern, (match, offset) => {
    if (boundaries && (!boundaries.has(offset) || !boundaries.has(offset + match.length))) {
      return match;
    }
    if (match === to) return match;
    replacements.push({ from: match, to, kind });
    return to;
  });
}

export function applyDictionaryCorrections(text, options = {}) {
  if (typeof text !== "string" || !text) {
    return { text: text || "", changed: false, replacements: [] };
  }

  const dictionary = normalizeDictionary(options.dictionary);
  const aliases = normalizeDictionaryAliases(options.aliases, dictionary);
  if (dictionary.length === 0 && aliases.length === 0) {
    return { text, changed: false, replacements: [] };
  }

  let corrected = text;
  const replacements = [];

  for (const alias of aliases) {
    corrected = replaceWholeTerm(corrected, alias.from, alias.to, "alias", replacements);
  }

  for (const target of dictionary) {
    corrected = replaceWholeTerm(corrected, target, target, "case", replacements);
  }

  corrected = corrected.replace(
    /(?<![\p{L}\p{N}_])([A-Za-z][A-Za-z0-9_-]*)(?![\p{L}\p{N}_])/gu,
    (match) => {
      for (const target of dictionary) {
        if (normalizeKey(match) === normalizeKey(target)) return match;
        if (isLikelyDictionaryMiss(match, target)) {
          replacements.push({ from: match, to: target, kind: "fuzzy" });
          return target;
        }
      }
      return match;
    }
  );

  return {
    text: corrected,
    changed: corrected !== text,
    replacements,
  };
}
