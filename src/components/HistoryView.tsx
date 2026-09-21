import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Loader2, Sparkles, Cloud, X, Mic, Trash2, Upload, BookOpen, Settings2 } from "lucide-react";
import TranscriptionItem from "./ui/TranscriptionItem";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { formatDateGroup } from "../utils/dateFormatting";
import { useSettingsStore } from "../stores/settingsStore";

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (show: boolean) => void;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => void;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onOpenUpload?: () => void;
  onOpenDictionary?: () => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number) => Promise<void>;
}

export default function HistoryView({
  history,
  isLoading,
  hotkey,
  showCloudMigrationBanner,
  setShowCloudMigrationBanner,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onOpenUpload,
  onOpenDictionary,
  onShowAudioInFolder,
  onRetryTranscription,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);

  const groupedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of history) {
      const label = formatDateGroup(item.timestamp, t);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [history, t]);

  return (
    <div className="ow-workspace-page">
      <div className="ow-page-column ow-page-column--fluid">
        <div className="ow-page-header">
          <div className="ow-page-heading">
            <h1 className="ow-page-title">{t("sidebar.home")}</h1>
            <p className="ow-page-description">{t("controlPanel.history.deskDescription")}</p>
          </div>
        </div>

        {showCloudMigrationBanner && (
          <div className="ow-panel mb-3 relative p-3">
            <button
              onClick={() => {
                setShowCloudMigrationBanner(false);
                localStorage.setItem("cloudMigrationShown", "true");
              }}
              aria-label={t("common.close")}
              className="absolute top-2 right-2 p-1 ow-icon-button-muted"
            >
              <X size={14} />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="shrink-0 w-8 h-8 rounded-md bg-muted border border-border flex items-center justify-center">
                <Cloud size={16} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground mb-0.5">
                  {t("controlPanel.cloudMigration.title")}
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("controlPanel.cloudMigration.description")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setShowCloudMigrationBanner(false);
                    localStorage.setItem("cloudMigrationShown", "true");
                    onOpenSettings("transcription");
                  }}
                >
                  {t("controlPanel.cloudMigration.viewSettings")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!useCleanupModel && !aiCTADismissed && (
          <div className="ow-panel mb-3 relative p-3">
            <button
              onClick={() => {
                localStorage.setItem("aiCTADismissed", "true");
                setAiCTADismissed(true);
              }}
              aria-label={t("common.close")}
              className="absolute top-2 right-2 p-1 ow-icon-button-muted"
            >
              <X size={14} />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="shrink-0 w-8 h-8 rounded-md bg-muted border border-border flex items-center justify-center">
                <Sparkles size={16} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground mb-0.5">
                  {t("controlPanel.aiCta.title")}
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("controlPanel.aiCta.description")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onOpenSettings("intelligence")}
                >
                  {t("controlPanel.aiCta.enable")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="h-full min-w-0">
          <div className="min-w-0 w-full">
            {!dataRetentionEnabled && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 px-3.5 py-2.5 flex items-center gap-2.5">
                <span className="text-amber-600 dark:text-amber-400 shrink-0 text-sm">⊘</span>
                <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  {t("controlPanel.history.dataRetentionDisabled")}
                </p>
              </div>
            )}
            {isLoading ? (
              <div className="min-h-[360px]">
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t("controlPanel.loading")}</span>
                </div>
              </div>
            ) : history.length === 0 ? (
              <div className="grid min-h-[420px] items-center gap-4 px-4 py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
                <div className="ow-surface-focus overflow-hidden">
                  <div className="border-b border-border/60 px-5 py-4 dark:border-white/8">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                      <Mic size={22} strokeWidth={1.7} />
                    </div>
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {t("controlPanel.history.deskTitle")}
                    </h3>
                    <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
                      {t("controlPanel.history.deskDescription")}
                    </p>
                  </div>
                  <div className="grid gap-0 divide-y divide-border/50 dark:divide-white/8">
                    <div className="flex items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {t("controlPanel.history.hotkeyLabel")}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("controlPanel.history.hotkeyDescription")}
                        </p>
                      </div>
                      <div className="ow-status-pill shrink-0">
                        <kbd className="font-mono text-xs font-semibold text-foreground">
                          {formatHotkeyLabel(hotkey)}
                        </kbd>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={onOpenUpload}
                        className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:border-border-hover hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                      >
                        <Upload size={14} className="shrink-0 text-primary" />
                        <span className="truncate">{t("controlPanel.history.quickUpload")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={onOpenDictionary}
                        className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:border-border-hover hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                      >
                        <BookOpen size={14} className="shrink-0 text-primary" />
                        <span className="truncate">{t("controlPanel.history.quickDictionary")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSettings("transcription")}
                        className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:border-border-hover hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                      >
                        <Settings2 size={14} className="shrink-0 text-primary" />
                        <span className="truncate">{t("controlPanel.history.quickSettings")}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="ow-surface-focus px-5 py-4">
                  <p className="text-xs font-semibold text-foreground">
                    {t("controlPanel.history.empty")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("controlPanel.history.emptyDescription")}
                  </p>
                  <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                    <span>{t("controlPanel.history.press")}</span>
                    <kbd className="rounded-sm bg-background/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                      {formatHotkeyLabel(hotkey)}
                    </kbd>
                    <span>{t("controlPanel.history.toStart")}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="group px-4 pb-4">
                {groupedHistory.map((group, index) => (
                  <div key={group.label} className={index > 0 ? "mt-6" : ""}>
                    <div className="sticky -top-4 z-10 -mx-4 flex items-center justify-between bg-background/95 px-5 pt-4 pb-2 backdrop-blur-sm">
                      <span className="rounded-sm bg-muted/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-white/[0.06]">
                        {group.label}
                      </span>
                      {index === 0 && (
                        <button
                          onClick={clearAllTranscriptions}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:!text-destructive hover:!bg-destructive/8 dark:hover:!bg-destructive/10 active:scale-[0.98] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 transition-all duration-200"
                        >
                          <Trash2 size={11} />
                          <span>{t("controlPanel.history.clearAll")}</span>
                        </button>
                      )}
                    </div>
                    <div className="relative z-0 space-y-2">
                      {group.items.map((item) => (
                        <TranscriptionItem
                          key={item.id}
                          item={item}
                          onCopy={copyToClipboard}
                          onDelete={deleteTranscription}
                          onShowAudioInFolder={onShowAudioInFolder}
                          onRetryTranscription={onRetryTranscription}
                          onOpenSettings={() => onOpenSettings("transcription")}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
