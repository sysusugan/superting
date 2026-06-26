export interface DictionaryAliasInput {
  from: string;
  to: string;
}

export type DictionaryInputSubmission =
  | {
      type: "none";
    }
  | {
      type: "words";
      words: string[];
    }
  | {
      type: "alias";
      alias: DictionaryAliasInput | null;
      shouldAddTargetWord: boolean;
    };

interface ResolveDictionaryInputSubmissionOptions {
  source: string;
  correction: string;
  dictionary: string[];
  aliases: DictionaryAliasInput[];
}

const normalize = (value: string) => value.trim().toLowerCase();

export function resolveDictionaryInputSubmission({
  source,
  correction,
  dictionary,
  aliases,
}: ResolveDictionaryInputSubmissionOptions): DictionaryInputSubmission {
  const sourceText = source.trim();
  const correctionText = correction.trim();
  if (!sourceText) return { type: "none" };

  if (!correctionText) {
    const words = sourceText
      .split(",")
      .map((word) => word.trim())
      .filter((word) => word && !dictionary.includes(word));

    return words.length > 0 ? { type: "words", words } : { type: "none" };
  }

  const sourceKey = normalize(sourceText);
  const correctionKey = normalize(correctionText);
  if (sourceKey === correctionKey) return { type: "none" };

  const aliasExists = aliases.some((alias) => normalize(alias.from) === sourceKey);
  const targetWordExists = dictionary.some((word) => normalize(word) === correctionKey);

  return {
    type: "alias",
    alias: aliasExists ? null : { from: sourceText, to: correctionText },
    shouldAddTargetWord: !targetWordExists,
  };
}
