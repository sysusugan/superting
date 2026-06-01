import { FilePen, MessageSquareText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import type { ActionItem } from "../../types/electron";
import { getActionDescription, getActionName } from "../../stores/actionStore";

type WriteTarget = "content" | "enhanced_content";
type WriteMode = "overwrite" | "append";

interface EmbeddedChatActionStripProps {
  actions: ActionItem[];
  disabled?: boolean;
  writableContent?: string | null;
  onRequestRunAction?: (action: ActionItem) => void;
  onPromptSubmit?: (text: string) => void;
  onWriteAssistantMessage?: (content: string, target: WriteTarget, writeMode: WriteMode) => void;
}

const promptActionKeys = ["summarize", "todos", "risks"] as const;

function ActionButton({
  icon,
  label,
  title,
  disabled,
  onClick,
  variant = "neutral",
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  variant?: "accent" | "neutral";
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium",
        "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35",
        variant === "accent"
          ? "bg-accent/7 text-accent/70 hover:bg-accent/12 hover:text-accent"
          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/8 hover:text-foreground/70"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function EmbeddedChatActionStrip({
  actions,
  disabled,
  writableContent,
  onRequestRunAction,
  onPromptSubmit,
  onWriteAssistantMessage,
}: EmbeddedChatActionStripProps) {
  const { t } = useTranslation();
  const hasWritableContent = !!writableContent?.trim();

  return (
    <div className="shrink-0 border-t border-border/10 dark:border-white/5 px-3 py-2">
      <div className="mb-1.5 text-[10px] font-medium text-foreground/30">
        {t("embeddedChat.actions.label")}
      </div>
      <div className="max-h-24 overflow-y-auto agent-chat-scroll">
        <div className="flex flex-wrap gap-1.5 pr-1">
          {promptActionKeys.map((key) => (
            <ActionButton
              key={key}
              disabled={disabled}
              icon={<MessageSquareText size={12} />}
              label={t(`embeddedChat.actions.prompts.${key}.label`)}
              title={t(`embeddedChat.actions.prompts.${key}.title`)}
              onClick={() => onPromptSubmit?.(t(`embeddedChat.actions.prompts.${key}.message`))}
            />
          ))}

          {actions.map((action) => (
            <ActionButton
              key={action.id}
              disabled={disabled}
              variant="accent"
              icon={<Sparkles size={12} />}
              label={getActionName(action, t)}
              title={getActionDescription(action, t) || getActionName(action, t)}
              onClick={() => onRequestRunAction?.(action)}
            />
          ))}

          {hasWritableContent && (
            <>
              <ActionButton
                disabled={disabled}
                icon={<FilePen size={12} />}
                label={t("embeddedChat.actions.write.appendEnhanced")}
                onClick={() =>
                  onWriteAssistantMessage?.(writableContent, "enhanced_content", "append")
                }
              />
              <ActionButton
                disabled={disabled}
                icon={<FilePen size={12} />}
                label={t("embeddedChat.actions.write.appendNote")}
                onClick={() => onWriteAssistantMessage?.(writableContent, "content", "append")}
              />
              <ActionButton
                disabled={disabled}
                icon={<FilePen size={12} />}
                label={t("embeddedChat.actions.write.overwriteEnhanced")}
                onClick={() =>
                  onWriteAssistantMessage?.(writableContent, "enhanced_content", "overwrite")
                }
              />
              <ActionButton
                disabled={disabled}
                icon={<FilePen size={12} />}
                label={t("embeddedChat.actions.write.overwriteNote")}
                onClick={() => onWriteAssistantMessage?.(writableContent, "content", "overwrite")}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
