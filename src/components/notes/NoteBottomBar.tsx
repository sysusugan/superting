import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Mic, ArrowUp, Square, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { formatRecordingElapsed } from "../../utils/recordingTime";

const BAR_COUNT = 5;

interface NoteBottomBarProps {
  isRecording: boolean;
  isProcessing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onAskSubmit: (text: string) => void;
  askDisabled?: boolean;
  actionPicker?: React.ReactNode;
  hideInput?: boolean;
  recordingStartedAt?: number | null;
}

export default function NoteBottomBar({
  isRecording,
  isProcessing,
  onStartRecording,
  onStopRecording,
  onAskSubmit,
  askDisabled,
  actionPicker,
  hideInput,
  recordingStartedAt,
}: NoteBottomBarProps) {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isRecording) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const elapsedLabel = formatRecordingElapsed(recordingStartedAt, nowMs);

  const hasText = inputText.trim().length > 0;

  const handleSubmit = useCallback(() => {
    const text = inputText.trim();
    if (!text || askDisabled) return;
    onAskSubmit(text);
    setInputText("");
    setIsExpanded(false);
  }, [inputText, askDisabled, onAskSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setIsExpanded(false);
        inputRef.current?.blur();
      }
    },
    [handleSubmit]
  );

  const handleInputFocus = useCallback(() => {
    setIsExpanded(true);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!hasText && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded, hasText]);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-0 left-0 right-0 z-10 max-w-full overflow-hidden px-5 pb-4 pt-3 pointer-events-none bg-gradient-to-t from-background via-background to-background/80"
    >
      <div
        className={cn(
          "flex min-w-0 items-end gap-2 pointer-events-auto",
          hideInput && "justify-center"
        )}
      >
        <div
          className={cn(
            "shrink-0 transition-all duration-300 ease-out overflow-hidden",
            "w-auto opacity-100"
          )}
        >
          {isRecording ? (
            <button
              onClick={onStopRecording}
              className={cn(
                "flex items-center gap-2 h-10 pl-3.5 pr-3 rounded-md",
                "bg-card dark:bg-white/[0.04]",
                "border border-border dark:border-white/12 shadow-sm",
                "transition-colors duration-150",
                "hover:bg-muted/70 dark:hover:bg-white/[0.06]"
              )}
            >
              <div className="flex items-end gap-0.5 h-3.5">
                {Array.from({ length: BAR_COUNT }, (_, i) => (
                  <div
                    key={i}
                    className="w-0.5 rounded-full bg-foreground/55 dark:bg-white/60 origin-bottom"
                    style={{
                      height: "100%",
                      animation: `waveform-bar ${0.5 + i * 0.07}s ease-in-out infinite`,
                      animationDelay: `${i * 0.04}s`,
                    }}
                  />
                ))}
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-foreground dark:text-white/80">
                {elapsedLabel}
              </span>
              <Square size={9} fill="currentColor" className="text-foreground/50" />
            </button>
          ) : isProcessing ? (
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-md",
                "bg-card dark:bg-white/[0.04]",
                "border border-border dark:border-white/12 shadow-sm"
              )}
            >
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <button
              onClick={onStartRecording}
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-md",
                "bg-card dark:bg-white/[0.04]",
                "border border-border dark:border-white/12 shadow-sm",
                "text-muted-foreground",
                "transition-all duration-200",
                "hover:bg-muted/70 dark:hover:bg-white/[0.06]",
                "hover:text-foreground",
                "hover:border-border-hover dark:hover:border-white/12",
                "active:scale-95"
              )}
              aria-label={t("notes.editor.transcribe")}
            >
              <Mic size={15} />
            </button>
          )}
        </div>

        {!hideInput && (
          <div
            className={cn(
              "flex-1 min-w-0 flex items-center h-10 px-3 gap-2",
              "rounded-md",
              "bg-card dark:bg-white/[0.04]",
              "border",
              "shadow-sm",
              "transition-all duration-200",
              isExpanded
                ? "border-border-hover dark:border-white/18 shadow-[0_0_0_3px_rgba(17,24,39,0.04)] dark:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]"
                : "border-border dark:border-white/12"
            )}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              disabled={askDisabled}
              placeholder={t("embeddedChat.askPlaceholder")}
              className={cn(
                "input-inline flex-1 bg-transparent outline-none min-w-0 p-0",
                "text-[13px] text-foreground",
                "placeholder:text-muted-foreground/75 dark:placeholder:text-foreground/45"
              )}
            />

            {hasText ? (
              <button
                onClick={handleSubmit}
                disabled={askDisabled}
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded-md shrink-0",
                  "bg-foreground dark:bg-foreground/90 text-background",
                  "transition-all duration-150",
                  "hover:bg-foreground/85 dark:hover:bg-foreground/80",
                  "active:scale-90",
                  "disabled:opacity-30"
                )}
                aria-label={t("embeddedChat.send")}
              >
                <ArrowUp size={13} strokeWidth={2.5} />
              </button>
            ) : (
              <div className="min-w-0 shrink">{actionPicker}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
