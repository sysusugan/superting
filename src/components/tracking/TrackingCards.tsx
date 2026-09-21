import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, GitBranch } from "lucide-react";

export function TrackingItemCard({
  title,
  itemType,
  state,
  properties,
  controls,
  children,
}: {
  title: string;
  itemType?: string;
  state?: string;
  properties?: Record<string, unknown>;
  controls?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <header className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-primary/10 p-2 text-primary">
            <GitBranch size={16} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-base font-semibold leading-snug">{title}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {itemType && (
                <span className="rounded-md bg-secondary px-2 py-1 text-secondary-foreground">
                  {itemType}
                </span>
              )}
              {state && <span className="break-words text-muted-foreground">{state}</span>}
            </div>
          </div>
        </div>
        {properties && Object.keys(properties).length > 0 && (
          <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
            {Object.entries(properties).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{key}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {controls}
      </header>
      {children && (
        <div className="border-t border-border/60 bg-muted/20 p-3 sm:p-5">{children}</div>
      )}
    </article>
  );
}

export function TrackingProgressList({ children }: { children: ReactNode }) {
  return (
    <div className="ml-2 space-y-3 border-l border-border pl-3 sm:ml-3 sm:pl-5">{children}</div>
  );
}

export function TrackingProgressEntry({
  type,
  content,
  date,
  evidence,
  meta,
}: {
  type: string;
  content: string;
  date?: string | null;
  evidence?: string;
  meta?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <article className="min-w-0 rounded-lg bg-background/70 px-3 py-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground">{type}</span>
        {date && <span className="text-muted-foreground">{date}</span>}
      </div>
      <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
      {meta && <div className="mt-3 space-y-1 text-xs text-muted-foreground">{meta}</div>}
      {evidence && (
        <blockquote className="mt-3 flex gap-2 border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
          <FileText size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="whitespace-pre-wrap break-words">
            <span className="sr-only">{t("trackingUI.evidence")}: </span>
            {evidence}
          </span>
        </blockquote>
      )}
    </article>
  );
}
