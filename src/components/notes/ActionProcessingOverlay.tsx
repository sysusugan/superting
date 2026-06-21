import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";
import type { ActionProcessingState } from "../../hooks/useActionProcessing";
import { shouldShowActionProcessingOverlay } from "./actionProcessingOverlayState";

interface ActionProcessingOverlayProps {
  state: ActionProcessingState;
  actionName: string | null;
}

export default function ActionProcessingOverlay({
  state,
  actionName,
}: ActionProcessingOverlayProps) {
  const { t } = useTranslation();
  const [isFadingOut, setIsFadingOut] = useState(false);
  const wasActiveRef = useRef(state === "processing" || state === "success");

  useEffect(() => {
    if (state !== "idle") {
      wasActiveRef.current = true;
      setIsFadingOut(false);
      return;
    }
    if (!wasActiveRef.current) return;
    setIsFadingOut(true);
    const id = setTimeout(() => {
      wasActiveRef.current = false;
      setIsFadingOut(false);
    }, 300);
    return () => clearTimeout(id);
  }, [state]);

  if (!shouldShowActionProcessingOverlay(state, isFadingOut)) return null;

  const isSuccess = state === "success";

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 justify-center",
        "transition-[opacity,transform] duration-300",
        isFadingOut && "opacity-0 pointer-events-none"
      )}
      style={!isFadingOut ? { animation: "float-up 0.25s ease-out" } : undefined}
    >
      <div
        className={cn(
          "relative flex min-w-52 flex-col gap-2 rounded-md border px-4 py-3 shadow-md",
          isSuccess
            ? "border-success/30 bg-card text-success"
            : "border-border-active/35 bg-card text-foreground",
          "transition-colors duration-300 dark:bg-surface-raised"
        )}
      >
        {isSuccess ? (
          <div className="flex items-center gap-2">
            <Check size={13} className="shrink-0 text-success" />
            <span className="text-xs font-semibold tracking-tight">{t("notes.actions.done")}</span>
          </div>
        ) : (
          <>
            <span className="truncate text-xs font-semibold tracking-tight">
              {actionName || t("notes.editor.processing")}
            </span>
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-accent">
              <div
                className="h-full w-1/3 rounded-full bg-primary"
                style={{ animation: "indeterminate 1.5s ease-in-out infinite" }}
                data-scanner-progress=""
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
