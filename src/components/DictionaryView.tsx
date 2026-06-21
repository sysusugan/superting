import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, X, CornerDownLeft, Info, Users, ArrowRight } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/dialog";
import { useSettings } from "../hooks/useSettings";
import { getAgentName } from "../utils/agentName";

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
  const [newWord, setNewWord] = useState("");
  const [aliasFrom, setAliasFrom] = useState("");
  const [aliasTo, setAliasTo] = useState("");
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [speakerNames, setSpeakerNames] = useState<SpeakerNameEntry[]>([]);

  const isEmpty = customDictionary.length === 0;
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
          <>
            <div className="ow-section">
            <div className="ow-section-header">
              <div className="flex items-baseline gap-2">
                <h2 className="ow-section-title">
                  {t("dictionary.peopleTitle")}
                </h2>
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
                <h2 className="ow-empty-state-title">
                  {t("dictionary.peopleTitle")}
                </h2>
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
          </>
        ) : isEmpty ? (
          /* ─── Empty state ─── */
          <div className="ow-empty-state-card mx-auto mt-8">
            <div className="ow-empty-state-visual mx-auto h-11 w-11">
              <BookOpen size={17} strokeWidth={1.5} className="text-foreground/35" />
            </div>

            <h2 className="ow-empty-state-title">
              {t("dictionary.title")}
            </h2>
            <p className="ow-empty-state-description mx-auto mb-5">
              {t("dictionary.description")}
            </p>

            <div className="w-full max-w-[300px] relative">
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/45 hover:text-foreground transition-colors"
                >
                  <CornerDownLeft size={11} />
                </button>
              ) : (
                <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground/12 font-mono select-none pointer-events-none">
                  ⏎
                </kbd>
              )}
            </div>

            <div className="flex max-w-[360px] flex-wrap items-center justify-center gap-1.5 mt-3">
              {["SuperTing", "Dr. Smith", "gRPC"].map((ex) => (
                <span
                  key={ex}
                  className="text-xs text-muted-foreground px-2 py-1 rounded-md border border-border/70 bg-background"
                >
                  {ex}
                </span>
              ))}
            </div>

            <div className="mt-8 w-full max-w-[260px]">
              <button
                onClick={() => setShowInfo(!showInfo)}
                aria-expanded={showInfo}
                aria-label={t("dictionary.howItWorks")}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                <Info size={9} />
                {t("dictionary.howItWorks")}
              </button>
              {showInfo && (
                <div className="mt-2.5 rounded-md bg-muted/50 border border-border/70 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground leading-[1.6]">
                    {t("dictionary.howItWorksDetail")}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ─── Populated state ─── */
          <>
            <div className="ow-section flex min-h-0 max-w-full flex-col p-0">
              <div className="ow-section-header mb-0 px-4 pt-4">
                <div className="flex items-baseline gap-2">
                  <h2 className="ow-section-title">{t("dictionary.title")}</h2>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    {customDictionary.length}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmClear(true)}
                  aria-label={t("dictionary.clearAll")}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  {t("dictionary.clearAll")}
                </Button>
              </div>

              <div className="ow-section-flat">
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
                <div className="mt-2 flex items-start gap-1.5 px-1">
                  <Info size={12} className="text-muted-foreground mt-px shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("dictionary.inputHint")}
                  </p>
                </div>
              </div>

              <div className="ow-section-divider ow-section-flat">
                <div className="flex flex-wrap gap-2">
                  {customDictionary.map((word) => {
                    const isAgentName = word === agentName;
                    return (
                      <span
                        key={word}
                        className={`group inline-flex items-center gap-1 py-[3px]
                      rounded-[5px] text-xs
                      border transition-colors duration-150
                      ${
                        isAgentName
                          ? "pl-2.5 pr-2.5 bg-muted text-foreground border-border dark:border-white/10"
                          : "pl-2.5 pr-1 bg-card dark:bg-white/[0.04] text-muted-foreground border-border hover:border-border-hover hover:bg-muted hover:text-foreground"
                      }`}
                        title={isAgentName ? t("dictionary.autoManaged") : undefined}
                      >
                        {word}
                        {!isAgentName && (
                          <button
                            onClick={() => handleRemove(word)}
                            aria-label={t("dictionary.removeWord", { word })}
                            className="p-0.5 rounded-sm
                          opacity-0 group-hover:opacity-100
                          text-muted-foreground hover:!text-destructive
                          transition-colors duration-150"
                          >
                            <X size={10} strokeWidth={2} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="ow-section-divider ow-section-flat">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">
                      {t("dictionary.aliasesTitle")}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("dictionary.aliasesDescription")}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    {customDictionaryAliases.length}
                  </span>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                  <Input
                    placeholder={t("dictionary.aliasFromPlaceholder")}
                    value={aliasFrom}
                    onChange={(e) => setAliasFrom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddAlias();
                    }}
                    className="h-8 text-xs"
                  />
                  <ArrowRight size={13} className="text-muted-foreground" />
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
                    className="h-8 px-2 text-xs"
                  >
                    {t("dictionary.aliasAdd")}
                  </Button>
                </div>

                {customDictionaryAliases.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {customDictionaryAliases.map((alias) => (
                      <span
                        key={`${alias.from}->${alias.to}`}
                        className="group inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-card px-2.5 py-[3px] text-xs text-muted-foreground transition-colors duration-150 hover:border-border-hover hover:bg-muted hover:text-foreground dark:bg-white/[0.04]"
                      >
                        <span>{alias.from}</span>
                        <ArrowRight size={10} className="text-muted-foreground/70" />
                        <span className="text-foreground">{alias.to}</span>
                        <button
                          onClick={() => handleRemoveAlias(alias.from)}
                          aria-label={t("dictionary.removeAlias", {
                            from: alias.from,
                            to: alias.to,
                          })}
                          className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 text-muted-foreground hover:!text-destructive transition-colors duration-150"
                        >
                          <X size={10} strokeWidth={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
