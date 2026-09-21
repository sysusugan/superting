import {
  TrackingItemCard,
  TrackingProgressList,
  TrackingProgressEntry,
} from "../tracking/TrackingCards";
import { groupTrackingUpdates } from "../tracking/groupTrackingUpdates";
import TrackingReview from "./TrackingReview";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

type TrackingExtraction = {
  id: number;
  status: string;
  result?: Record<string, unknown> | null;
  stale?: boolean;
  reviewResult?: Record<string, unknown> | null;
};

type TrackingData = {
  noteId?: number;
  reviewSnapshot?: string;
  items?: Array<Record<string, unknown>>;
  candidates?: Array<{
    id: number;
    title: string;
    itemType: string;
    state: string;
    linked: boolean;
  }>;
  loadFailed?: boolean;
  extractions?: TrackingExtraction[];
  updates?: Array<{
    id: number;
    item_id?: number;
    item_title: string;
    item_type: string;
    update_type: string;
    content: string;
    evidence_text: string;
    occurred_at: string | null;
  }>;
};

export default function TrackingPanel({
  data,
  isExtracting,
  onExtract,
  onReviewSaved,
}: {
  data: TrackingData | null;
  isExtracting: boolean;
  onExtract: (force?: boolean) => void;
  onReviewSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const latest = data?.extractions?.[0] ?? null;
  const uncertainties = Array.isArray(latest?.result?.uncertainties)
    ? latest.result.uncertainties
    : [];
  const hasExtractedItems = ["matchedItems", "newItems", "updates"].some(
    (key) => Array.isArray(latest?.result?.[key]) && (latest.result[key] as unknown[]).length > 0
  );
  const confirmedUpdates = data?.updates ?? [];
  const confirmedItems = data?.items ?? [];
  const { groups, unassigned } = groupTrackingUpdates(
    confirmedItems,
    confirmedUpdates,
    (item) => (typeof item.id === "number" ? item.id : undefined),
    (update) => update.item_id
  );
  const progress = (entries: typeof confirmedUpdates) => (
    <TrackingProgressList>
      {entries.map((update) => (
        <TrackingProgressEntry
          key={update.id}
          type={update.update_type}
          content={update.content}
          date={update.occurred_at}
          evidence={update.evidence_text}
        />
      ))}
    </TrackingProgressList>
  );
  return (
    <div className="mx-5 mt-5 mb-24 flex h-[calc(100%-7rem)] flex-col gap-4 overflow-y-auto rounded-xl border border-border/50 bg-background/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("notes.editor.trackingTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("notes.editor.trackingDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onExtract(Boolean(latest))}
          disabled={isExtracting || !data}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {isExtracting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {isExtracting
            ? t("notes.editor.trackingExtracting")
            : t(latest ? "notes.editor.trackingReextract" : "notes.editor.trackingExtract")}
        </button>
      </div>

      <p role="status" className="text-xs text-muted-foreground">
        {data?.loadFailed
          ? t("notes.trackingStatus.loadFailed")
          : !data
            ? t("common.loading")
            : latest
              ? t(`notes.trackingStatus.${latest.status}`)
              : t("notes.trackingStatus.notExtracted")}
      </p>
      {latest && !hasExtractedItems && (
        <p className="text-sm text-muted-foreground">{t("notes.trackingStatus.empty")}</p>
      )}
      {latest?.status !== "pending" && uncertainties.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("notes.trackingStatus.uncertainties")}</h3>
          {uncertainties.map((value, index) => {
            const entry = typeof value === "string" ? { content: value } : value || {};
            return (
              <div key={index} className="rounded-md border border-border/50 p-3 text-sm">
                {entry.title && <p className="font-medium">{String(entry.title)}</p>}
                <p>{String(entry.content || "")}</p>
                {entry.evidence && (
                  <blockquote className="mt-2 text-xs text-muted-foreground">
                    {String(entry.evidence)}
                  </blockquote>
                )}
              </div>
            );
          })}
        </section>
      )}

      {!!groups.length && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t("notes.editor.trackingConfirmed")}</h3>
          {groups.map(({ item, updates }) => (
            <TrackingItemCard
              key={String(item.id)}
              title={String(item.title)}
              itemType={String(item.itemType || "")}
              state={String(item.state || "")}
              properties={
                item.properties && typeof item.properties === "object"
                  ? (item.properties as Record<string, unknown>)
                  : undefined
              }
              controls={
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("superting-open-tracking-item", { detail: item.id })
                    )
                  }
                >
                  {t("trackingCenter.open")}
                </button>
              }
            >
              {updates.length ? (
                progress(updates)
              ) : (
                <p className="text-xs text-muted-foreground">{t("trackingCenter.noProgress")}</p>
              )}
            </TrackingItemCard>
          ))}
        </section>
      )}
      {!!unassigned.length && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("trackingUI.unassigned")}</h3>
          {progress(unassigned)}
        </section>
      )}

      {data && <TrackingReview data={data} disabled={isExtracting} onSaved={onReviewSaved} />}
      {(data?.extractions ?? []).map((extraction) => (
        <details key={extraction.id} className="rounded-md border border-border/40 p-3 text-xs">
          <summary className="cursor-pointer">
            {t("notes.trackingStatus.savedResult")} #{extraction.id} ·{" "}
            {t(`notes.trackingStatus.${extraction.status}`)}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {JSON.stringify(extraction.result, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}
