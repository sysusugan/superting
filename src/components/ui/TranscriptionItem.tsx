import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Tooltip } from "./tooltip";
import {
  Copy,
  Trash2,
  FileText,
  FolderOpen,
  RotateCcw,
  Loader2,
  AlertCircle,
  ArrowRight,
  Plus,
} from "lucide-react";
import type {
  TranscriptionItem as TranscriptionItemType,
  TranscriptionErrorCode,
} from "../../types/electron";
import { cn } from "../lib/utils";
import { getCachedPlatform } from "../../utils/platform";
import { getDictionaryCorrections, getVoiceFlowMetadata } from "../../utils/voiceFlowMetadata";
import { getSettings, useSettingsStore } from "../../stores/settingsStore";

const platform = getCachedPlatform();

function getShowInFolderKey(): string {
  if (platform === "win32") return "controlPanel.history.showInFolderWindows";
  if (platform === "linux") return "controlPanel.history.showInFolderLinux";
  return "controlPanel.history.showInFolder";
}

interface TranscriptionItemProps {
  item: TranscriptionItemType;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onShowAudioInFolder?: (id: number) => void;
  onRetryTranscription?: (id: number) => Promise<void>;
  onOpenSettings?: () => void;
}

export default function TranscriptionItem({
  item,
  onCopy,
  onDelete,
  onShowAudioInFolder,
  onRetryTranscription,
  onOpenSettings,
}: TranscriptionItemProps) {
  const { t, i18n } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const corrections = getDictionaryCorrections(item);
  const voiceFlow = getVoiceFlowMetadata(item);
  const customDictionaryAliases = useSettingsStore((state) => state.customDictionaryAliases);

  const timestampSource = item.timestamp.endsWith("Z") ? item.timestamp : `${item.timestamp}Z`;
  const timestampDate = new Date(timestampSource);
  const formattedTime = Number.isNaN(timestampDate.getTime())
    ? ""
    : timestampDate.toLocaleTimeString(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      });

  const handleRetry = async () => {
    if (isRetrying || !onRetryTranscription) return;
    setIsRetrying(true);
    try {
      await onRetryTranscription(item.id);
    } finally {
      setIsRetrying(false);
    }
  };

  const isFailed = item.status === "failed";
  const hasRawText = item.raw_text !== null;
  const hasAudio = item.has_audio === 1;
  const showUtilityGroup = hasRawText || hasAudio;

  const errorCode = item.error_code as TranscriptionErrorCode;
  const isConfigError =
    errorCode === "API_KEY_MISSING" ||
    errorCode === "INVALID_KEY" ||
    errorCode === "MODEL_NOT_AVAILABLE";
  const isLimitError = errorCode === "LIMIT_REACHED";
  const isOfflineError = errorCode === "OFFLINE";

  const addAliasFromCorrection = (from: string, to: string) => {
    const { customDictionary } = getSettings();
    const settingsStore = useSettingsStore.getState();
    const normalizedFrom = from.trim();
    const normalizedTo = to.trim();
    if (!normalizedFrom || !normalizedTo || normalizedFrom.toLowerCase() === normalizedTo.toLowerCase()) {
      return;
    }
    const aliasExists = customDictionaryAliases.some(
      (alias) => alias.from.toLowerCase() === normalizedFrom.toLowerCase()
    );
    if (!aliasExists) {
      settingsStore.setCustomDictionaryAliases([
        ...customDictionaryAliases,
        { from: normalizedFrom, to: normalizedTo },
      ]);
    }
    const dictionaryExists = customDictionary.some(
      (word) => word.toLowerCase() === normalizedTo.toLowerCase()
    );
    if (!dictionaryExists) {
      settingsStore.setCustomDictionary([...customDictionary, normalizedTo]);
    }
  };

  return (
    <div
      className={cn(
        "group rounded-md border px-3 py-2.5 transition-colors duration-150",
        isFailed
          ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
          : "border-border/60 dark:border-border-subtle/70 bg-background dark:bg-surface-2/50 hover:bg-muted/30 dark:hover:bg-surface-2/80"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start gap-3">
        {formattedTime && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums pt-0.5">
            {formattedTime}
          </span>
        )}

        {isFailed ? (
          <div className="flex-1 min-w-0 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 text-destructive mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm text-destructive font-medium">
                {t("controlPanel.history.transcriptionFailed")}
              </p>
              {item.error_message && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {item.error_message}
                </p>
              )}
              {isConfigError && (
                <p className="text-xs text-muted-foreground mt-1">
                  {hasAudio ? (
                    <>
                      <button
                        onClick={() => onOpenSettings?.()}
                        className="text-foreground/70 hover:text-foreground hover:underline cursor-pointer"
                      >
                        {t("controlPanel.history.failedCtaSettings")}
                      </button>{" "}
                      {t("controlPanel.history.failedCtaAndRetry")}
                    </>
                  ) : (
                    <button
                      onClick={() => onOpenSettings?.()}
                      className="text-foreground/70 hover:text-foreground hover:underline cursor-pointer"
                    >
                      {t("controlPanel.history.failedCtaSettingsOnly")}
                    </button>
                  )}
                </p>
              )}
              {isLimitError && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("controlPanel.history.failedLimitReached")}
                </p>
              )}
              {isOfflineError && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("controlPanel.history.failedOffline")}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="flex-1 min-w-0 text-foreground text-sm leading-[1.5] break-words">
            {item.text}
          </p>
        )}

        <div
          className={cn(
            "flex items-center gap-0.5 shrink-0 transition-opacity duration-150",
            isFailed ? "opacity-100" : isHovered ? "opacity-100" : "opacity-0"
          )}
        >
          {isFailed && hasAudio && (
            <Tooltip content={t("controlPanel.history.retryTranscription")}>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRetry}
                disabled={isRetrying}
                className="h-6 w-6 rounded-sm text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {isRetrying ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
              </Button>
            </Tooltip>
          )}
          {!isFailed && hasRawText && (
            <Tooltip content={t("controlPanel.history.viewRawTranscript")}>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsExpanded(!isExpanded)}
                className={cn(
                  "h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]",
                  isExpanded && "text-foreground"
                )}
              >
                <FileText size={12} />
              </Button>
            </Tooltip>
          )}
          {hasAudio && (
            <Tooltip content={t(getShowInFolderKey())}>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onShowAudioInFolder?.(item.id)}
                className="h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]"
              >
                <FolderOpen size={12} />
              </Button>
            </Tooltip>
          )}
          {!isFailed && hasAudio && (
            <Tooltip content={t("controlPanel.history.retryTranscription")}>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRetry}
                disabled={isRetrying}
                className="h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]"
              >
                {isRetrying ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
              </Button>
            </Tooltip>
          )}
          {showUtilityGroup && <div className="w-px h-3 bg-border/30" />}
          {!isFailed && (
            <Tooltip content={t("controlPanel.history.copyText")}>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onCopy(item.text)}
                className="h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10"
              >
                <Copy size={12} />
              </Button>
            </Tooltip>
          )}
          <Tooltip content={t("controlPanel.history.deleteItem")}>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(item.id)}
              className="h-6 w-6 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={12} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {!isFailed && (
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            isExpanded ? "max-h-96" : "max-h-0"
          )}
        >
          <div className="border-t border-border/20 mt-2 pt-2">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t("controlPanel.history.rawTranscript")}
            </span>
            <p className="text-xs text-muted-foreground/80 leading-relaxed mt-1">{item.raw_text}</p>
            {voiceFlow?.warning === "cleanup_failed" && (
              <p className="text-[10px] text-muted-foreground/50 italic mt-1">
                {t("controlPanel.history.cleanupFailed")}
              </p>
            )}
            {voiceFlow?.warning !== "cleanup_failed" && item.raw_text === item.text && (
              <p className="text-[10px] text-muted-foreground/50 italic mt-1">
                {t("controlPanel.history.noAiProcessing")}
              </p>
            )}
            {corrections.length > 0 && (
              <div className="mt-3">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("controlPanel.history.dictionaryCorrections")}
                </span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {corrections.map((correction) => {
                    const aliasExists = customDictionaryAliases.some(
                      (alias) => alias.from.toLowerCase() === correction.from.toLowerCase()
                    );
                    return (
                      <span
                        key={`${correction.from}->${correction.to}->${correction.kind || ""}`}
                        className="inline-flex items-center gap-1 rounded-[5px] border border-border/70 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        <span>{correction.from}</span>
                        <ArrowRight size={10} className="text-muted-foreground/60" />
                        <span className="text-foreground">{correction.to}</span>
                        {correction.kind && (
                          <span className="rounded bg-background/70 px-1 text-[10px] text-muted-foreground/80">
                            {correction.kind}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={aliasExists}
                          onClick={() => addAliasFromCorrection(correction.from, correction.to)}
                          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-35"
                          aria-label={t("controlPanel.history.addCorrectionAlias", {
                            from: correction.from,
                            to: correction.to,
                          })}
                        >
                          <Plus size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
