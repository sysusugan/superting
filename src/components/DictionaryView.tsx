import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, X, CornerDownLeft, Info, Users } from "lucide-react";
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
  const { customDictionary, setCustomDictionary } = useSettings();
  const agentName = getAgentName();
  const [activeTab, setActiveTab] = useState<"dictionary" | "people">("dictionary");
  const [newWord, setNewWord] = useState("");
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
          onConfirm={() => setCustomDictionary(customDictionary.filter((w) => w === agentName))}
          variant="destructive"
        />

        <div className="pb-5">
          <div className="ow-segmented inline-flex text-xs">
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
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {activeTabDescription}
          </p>
        </div>

        {activeTab === "people" ? (
          <>
            <div className="flex items-baseline justify-between pb-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("dictionary.peopleTitle")}
                </h2>
                <span className="text-xs text-muted-foreground font-mono tabular-nums">
                  {speakerNames.length}
                </span>
              </div>
            </div>
            <div className="rounded-md bg-muted/25 p-3 dark:bg-white/[0.025]">
              {renderAddInput(
                newSpeakerName,
                setNewSpeakerName,
                handleAddSpeakerName,
                t("dictionary.addPersonPlaceholder"),
                t("dictionary.addPerson")
              )}
            </div>
            {speakerNames.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center px-8 -mt-8">
                <div className="w-10 h-10 rounded-[10px] bg-foreground/[0.03] border border-foreground/8 flex items-center justify-center mb-4">
                  <Users size={17} strokeWidth={1.5} className="text-muted-foreground" />
                </div>
                <h2 className="text-xs font-semibold text-foreground mb-1">
                  {t("dictionary.peopleTitle")}
                </h2>
                <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[260px]">
                  {t("dictionary.peopleDescription")}
                </p>
              </div>
            ) : (
              <div className="mt-3 flex-1 overflow-y-auto rounded-md bg-muted/20 p-3 dark:bg-white/[0.02]">
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
          </>
        ) : isEmpty ? (
          /* ─── Empty state ─── */
          <div className="flex-1 flex flex-col items-center justify-center px-8">
            <div className="w-11 h-11 rounded-md bg-muted/60 border border-border/70 flex items-center justify-center mb-4">
              <BookOpen size={17} strokeWidth={1.5} className="text-foreground/35" />
            </div>

            <h2 className="text-lg font-semibold tracking-tight text-foreground mb-1">
              {t("dictionary.title")}
            </h2>
            <p className="text-sm text-muted-foreground text-center leading-relaxed max-w-[320px] mb-6">
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
              {["OpenWhispr", "Dr. Smith", "gRPC"].map((ex) => (
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
            <div className="flex min-h-0 max-w-full flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{t("dictionary.title")}</h2>
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

              <div className="rounded-md bg-muted/25 p-3 dark:bg-white/[0.025]">
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

              <div className="flex-1 overflow-y-auto rounded-md bg-muted/20 p-3 dark:bg-white/[0.02]">
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
