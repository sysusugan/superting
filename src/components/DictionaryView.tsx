import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, X, CornerDownLeft, Info, Users, ArrowRight, Search } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/dialog";
import { cn } from "./lib/utils";
import { useSettings } from "../hooks/useSettings";
import { getAgentName } from "../utils/agentName";
import {
  buildDictionaryDisplayItems,
  filterDictionaryDisplayItems,
  type DictionaryDisplayItem,
} from "../utils/dictionaryListItems";

interface SpeakerNameEntry {
  id: number;
  display_name: string;
  email: string | null;
}

export default function DictionaryView() {
  const { t } = useTranslation();
  const {
    customDictionary,
    customDictionaryAliases,
    setCustomDictionary,
    setCustomDictionaryAliases,
  } = useSettings();
  const agentName = getAgentName();
  const [activeTab, setActiveTab] = useState<"dictionary" | "people">("dictionary");
  const [dictionarySearch, setDictionarySearch] = useState("");
  const [newWord, setNewWord] = useState("");
  const [aliasFrom, setAliasFrom] = useState("");
  const [aliasTo, setAliasTo] = useState("");
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [speakerNames, setSpeakerNames] = useState<SpeakerNameEntry[]>([]);

  const dictionaryItems = useMemo(
    () =>
      buildDictionaryDisplayItems({
        dictionary: customDictionary,
        aliases: customDictionaryAliases,
      }),
    [customDictionary, customDictionaryAliases]
  );
  const filteredDictionaryItems = useMemo(
    () => filterDictionaryDisplayItems(dictionaryItems, dictionarySearch),
    [dictionaryItems, dictionarySearch]
  );
  const isDictionaryEmpty = dictionaryItems.length === 0;
  const hasSearchQuery = dictionarySearch.trim().length > 0;
  const activeTabDescription =
    activeTab === "dictionary" ? t("dictionary.dictionaryUsage") : t("dictionary.peopleUsage");

  const refreshSpeakerNames = useCallback(() => {
    window.electronAPI?.getSpeakerNames?.().then((names) => {
      setSpeakerNames(
        (names || []).map((entry) => ({
          id: entry.id,
          display_name: entry.display_name,
          email: entry.email,
        }))
      );
    });
  }, []);

  useEffect(() => {
    refreshSpeakerNames();
  }, [refreshSpeakerNames]);

  const handleAdd = useCallback(() => {
    const words = newWord
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w && !customDictionary.includes(w));
    if (words.length > 0) {
      setCustomDictionary([...customDictionary, ...words]);
      setNewWord("");
    }
  }, [newWord, customDictionary, setCustomDictionary]);

  const handleRemove = useCallback(
    (word: string) => {
      if (word === agentName) return;
      setCustomDictionary(customDictionary.filter((w) => w !== word));
    },
    [customDictionary, setCustomDictionary, agentName]
  );

  const handleClearDictionary = useCallback(() => {
    setCustomDictionary(customDictionary.filter((w) => w === agentName));
    setCustomDictionaryAliases([]);
    setDictionarySearch("");
  }, [agentName, customDictionary, setCustomDictionary, setCustomDictionaryAliases]);

  const handleAddAlias = useCallback(() => {
    const from = aliasFrom.trim();
    const to = aliasTo.trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;

    const exists = customDictionaryAliases.some(
      (alias) => alias.from.toLowerCase() === from.toLowerCase()
    );
    if (!exists) {
      setCustomDictionaryAliases([...customDictionaryAliases, { from, to }]);
    }
    if (!customDictionary.some((word) => word.toLowerCase() === to.toLowerCase())) {
      setCustomDictionary([...customDictionary, to]);
    }
    setAliasFrom("");
    setAliasTo("");
  }, [
    aliasFrom,
    aliasTo,
    customDictionary,
    customDictionaryAliases,
    setCustomDictionary,
    setCustomDictionaryAliases,
  ]);

  const handleRemoveAlias = useCallback(
    (from: string) => {
      setCustomDictionaryAliases(
        customDictionaryAliases.filter((alias) => alias.from.toLowerCase() !== from.toLowerCase())
      );
    },
    [customDictionaryAliases, setCustomDictionaryAliases]
  );

  const handleAddSpeakerName = useCallback(async () => {
    const name = newSpeakerName.trim();
    if (!name) return;
    const result = await window.electronAPI?.upsertSpeakerName?.(name, null);
    if (result?.success) {
      setNewSpeakerName("");
      refreshSpeakerNames();
    }
  }, [newSpeakerName, refreshSpeakerNames]);

  const handleRemoveSpeakerName = useCallback(
    async (id: number) => {
      const result = await window.electronAPI?.deleteSpeakerName?.(id);
      if (result?.success) refreshSpeakerNames();
    },
    [refreshSpeakerNames]
  );

  const renderAddInput = (
    value: string,
    setValue: (value: string) => void,
    onAdd: () => void,
    placeholder: string,
    ariaLabel: string
  ) => (
    <div className="relative">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAdd();
        }}
        className="w-full h-8 text-xs pr-8"
      />
      {value.trim() ? (
        <button
          onClick={onAdd}
          aria-label={ariaLabel}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <CornerDownLeft size={10} />
        </button>
      ) : (
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70 font-mono select-none pointer-events-none">
          ⏎
        </kbd>
      )}
    </div>
  );

  const renderDictionaryRow = (item: DictionaryDisplayItem) => {
    if (item.type === "word") {
      const isAgentName = item.word === agentName;

      return (
        <div
          key={item.id}
          className="group flex min-h-11 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-muted/35"
          title={isAgentName ? t("dictionary.autoManaged") : undefined}
        >
          <span className="inline-flex shrink-0 items-center rounded-sm border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
            {t("dictionary.itemTypeWord")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{item.word}</div>
          </div>
          {!isAgentName ? (
            <button
              onClick={() => handleRemove(item.word)}
              aria-label={t("dictionary.removeWord", { word: item.word })}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X size={13} strokeWidth={2} />
            </button>
          ) : (
            <span className="h-7 w-7 shrink-0" />
          )}
        </div>
      );
    }

    return (
      <div
        key={item.id}
        className="group flex min-h-11 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-muted/35"
      >
        <span className="inline-flex shrink-0 items-center rounded-sm border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary dark:border-primary/25 dark:bg-primary/15 dark:text-primary">
          {t("dictionary.itemTypeAlias")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="min-w-0 max-w-full break-words text-muted-foreground">
              {item.from}
            </span>
            <ArrowRight size={13} className="shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 max-w-full break-words font-semibold text-foreground">
              {item.to}
            </span>
          </div>
        </div>
        <button
          onClick={() => handleRemoveAlias(item.from)}
          aria-label={t("dictionary.removeAlias", {
            from: item.from,
            to: item.to,
          })}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    );
  };

  return (
    <div className="ow-workspace-page">
      <div className="ow-page-column">
        <ConfirmDialog
          open={confirmClear}
          onOpenChange={setConfirmClear}
          title={t("dictionary.clearTitle")}
          description={t("dictionary.clearDescription")}
          onConfirm={handleClearDictionary}
          variant="destructive"
        />

        <div className="ow-page-header">
          <div className="ow-page-heading">
            <h1 className="ow-page-title">{t("dictionary.title")}</h1>
            <p className="ow-page-description">{activeTabDescription}</p>
          </div>
          <div className="ow-segmented inline-flex shrink-0 text-xs">
            <button
              onClick={() => setActiveTab("dictionary")}
              className={`ow-segmented-item ${
                activeTab === "dictionary" ? "ow-segmented-item-active" : ""
              }`}
            >
              {t("dictionary.dictionary")}
            </button>
            <button
              onClick={() => setActiveTab("people")}
              className={`ow-segmented-item ${
                activeTab === "people" ? "ow-segmented-item-active" : ""
              }`}
            >
              {t("dictionary.people")}
            </button>
          </div>
        </div>

        <div className="ow-page-body">
          {activeTab === "people" ? (
            <div className="ow-section">
              <div className="ow-section-header">
                <div className="flex items-baseline gap-2">
                  <h2 className="ow-section-title">{t("dictionary.peopleTitle")}</h2>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    {speakerNames.length}
                  </span>
                </div>
              </div>
              <div className="ow-section-muted">
                {renderAddInput(
                  newSpeakerName,
                  setNewSpeakerName,
                  handleAddSpeakerName,
                  t("dictionary.addPersonPlaceholder"),
                  t("dictionary.addPerson")
                )}
              </div>
              {speakerNames.length === 0 ? (
                <div className="ow-empty-state-card mx-auto mt-4">
                  <div className="ow-empty-state-visual mx-auto h-11 w-11">
                    <Users size={17} strokeWidth={1.5} className="text-muted-foreground" />
                  </div>
                  <h2 className="ow-empty-state-title">{t("dictionary.peopleTitle")}</h2>
                  <p className="ow-empty-state-description mx-auto">
                    {t("dictionary.peopleDescription")}
                  </p>
                </div>
              ) : (
                <div className="ow-section-muted mt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {speakerNames.map((entry) => (
                      <span
                        key={entry.id}
                        className="group inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-border-hover hover:bg-muted/60 hover:text-foreground dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                      >
                        {entry.display_name}
                        <button
                          onClick={() => handleRemoveSpeakerName(entry.id)}
                          aria-label={t("dictionary.removePerson", { name: entry.display_name })}
                          className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 text-foreground/25 hover:!text-destructive/70 transition-colors duration-150"
                        >
                          <X size={10} strokeWidth={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="ow-section flex min-h-0 max-w-full flex-col p-0">
              <div className="ow-section-header mb-0 px-4 pt-4">
                <div className="flex items-baseline gap-2">
                  <h2 className="ow-section-title">{t("dictionary.title")}</h2>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    {dictionaryItems.length}
                  </span>
                </div>
                {!isDictionaryEmpty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmClear(true)}
                    aria-label={t("dictionary.clearAll")}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    {t("dictionary.clearAll")}
                  </Button>
                )}
              </div>

              <div className="ow-section-flat">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label={t("dictionary.searchAriaLabel")}
                    placeholder={t("dictionary.searchPlaceholder")}
                    value={dictionarySearch}
                    onChange={(e) => setDictionarySearch(e.target.value)}
                    className="h-9 pl-8 pr-8 text-xs"
                  />
                  {hasSearchQuery && (
                    <button
                      onClick={() => setDictionarySearch("")}
                      aria-label={t("dictionary.clearSearch")}
                      className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>

              <div className="ow-section-divider ow-section-flat space-y-3">
                <div className="relative">
                  <Input
                    placeholder={t("dictionary.addPlaceholder")}
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAdd();
                    }}
                    className="w-full pr-8"
                  />
                  {newWord.trim() ? (
                    <button
                      onClick={handleAdd}
                      aria-label={t("dictionary.addWord")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <CornerDownLeft size={10} />
                    </button>
                  ) : (
                    <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70 font-mono select-none pointer-events-none">
                      ⏎
                    </kbd>
                  )}
                </div>

                <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                  <Input
                    placeholder={t("dictionary.aliasFromPlaceholder")}
                    value={aliasFrom}
                    onChange={(e) => setAliasFrom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddAlias();
                    }}
                    className="h-8 text-xs"
                  />
                  <ArrowRight size={13} className="hidden text-muted-foreground md:block" />
                  <Input
                    placeholder={t("dictionary.aliasToPlaceholder")}
                    value={aliasTo}
                    onChange={(e) => setAliasTo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddAlias();
                    }}
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddAlias}
                    disabled={!aliasFrom.trim() || !aliasTo.trim()}
                    className="h-8 w-full px-3 text-xs md:w-auto"
                  >
                    {t("dictionary.aliasAdd")}
                  </Button>
                </div>

                <div className="flex items-start gap-1.5 px-1">
                  <Info size={12} className="text-muted-foreground mt-px shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("dictionary.inputHint")}
                  </p>
                </div>
              </div>

              <div className="ow-section-divider min-h-0">
                {isDictionaryEmpty ? (
                  <div className="px-4 py-8 text-center">
                    <div className="ow-empty-state-visual mx-auto h-11 w-11">
                      <BookOpen size={17} strokeWidth={1.5} className="text-foreground/35" />
                    </div>
                    <h2 className="ow-empty-state-title">{t("dictionary.title")}</h2>
                    <p className="ow-empty-state-description mx-auto mb-5">
                      {t("dictionary.description")}
                    </p>
                    <div className="mx-auto flex max-w-[360px] flex-wrap items-center justify-center gap-1.5">
                      {["SuperTing", "Dr. Smith", "gRPC"].map((example) => (
                        <span
                          key={example}
                          className="text-xs text-muted-foreground px-2 py-1 rounded-md border border-border/70 bg-background"
                        >
                          {example}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowInfo(!showInfo)}
                      aria-expanded={showInfo}
                      aria-label={t("dictionary.howItWorks")}
                      className="mt-5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
                    >
                      <Info size={9} />
                      {t("dictionary.howItWorks")}
                    </button>
                    {showInfo && (
                      <div className="mx-auto mt-2.5 max-w-[360px] rounded-md bg-muted/50 border border-border/70 px-3 py-2.5">
                        <p className="text-xs text-muted-foreground leading-[1.6]">
                          {t("dictionary.howItWorksDetail")}
                        </p>
                      </div>
                    )}
                  </div>
                ) : filteredDictionaryItems.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm font-semibold text-foreground">
                      {t("dictionary.emptySearchTitle")}
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                      {t("dictionary.emptySearchDescription")}
                    </p>
                  </div>
                ) : (
                  <div className={cn("divide-y divide-border/60 dark:divide-white/8")}>
                    {filteredDictionaryItems.map(renderDictionaryRow)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
