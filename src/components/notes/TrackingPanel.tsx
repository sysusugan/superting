import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

type TrackingExtraction = {
  id: number;
  status: string;
  result?: Record<string, unknown> | null;
  reviewResult?: Record<string, unknown> | null;
};

type TrackingData = {
  candidates?: Array<{ id: number; title: string; itemType: string; state: string; linked: boolean }>;
  loadFailed?: boolean;
  extractions?: TrackingExtraction[];
  updates?: Array<{
    id: number;
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
  onConfirm,
  onReject,
}: {
  data: TrackingData | null;
  isExtracting: boolean;
  onExtract: (force?: boolean) => void;
  onConfirm: (id: number, result: Record<string, unknown>) => void;
  onReject: (id: number) => void;
}) {
  const { t } = useTranslation();
  const latest = data?.extractions?.[0] ?? null;
  const uncertainties = Array.isArray(latest?.result?.uncertainties)
    ? latest.result.uncertainties
    : [];
  const hasExtractedItems = ["matchedItems", "newItems", "updates"].some(
    (key) => Array.isArray(latest?.result?.[key]) && (latest.result[key] as unknown[]).length > 0
  );
  const [draft, setDraft] = useState(() => JSON.stringify(latest?.reviewResult || latest?.result || {}, null, 2));

  useEffect(() => {
    setDraft(latest?.result ? JSON.stringify(latest.reviewResult || latest.result, null, 2) : "");
  }, [latest?.id, latest?.result, latest?.reviewResult]);

  const confirmedUpdates = useMemo(() => data?.updates ?? [], [data?.updates]);
  const confirmedItems = useMemo(() => {
    const seen = new Set<string>();
    return (data?.extractions ?? [])
      .filter((extraction) => extraction.status === "confirmed")
      .flatMap((extraction) => {
        const result = extraction.result || {};
        return [
          ...(Array.isArray(result.matchedItems) ? result.matchedItems : []),
          ...(Array.isArray(result.newItems) ? result.newItems : []),
        ];
      })
      .filter((item) => {
        const title = String((item as Record<string, unknown>)?.title || "").trim();
        if (!title || seen.has(title)) return false;
        seen.add(title);
        return true;
      }) as Array<Record<string, unknown>>;
  }, [data?.extractions]);
  let parsedDraft: Record<string, unknown> | null = null;
  try {
    parsedDraft = draft ? JSON.parse(draft) : null;
  } catch {
    parsedDraft = null;
  }
  const draftItems = ['matchedItems', 'newItems'].flatMap(key =>
    Array.isArray(parsedDraft?.[key]) ? (parsedDraft[key] as Record<string, unknown>[]).map((item, index) => ({key, index, item})) : []);
  const candidates = data?.candidates || [];
  const resolved = !!parsedDraft && draftItems.every(({item}) =>
    item.createNew === true || candidates.some(candidate => candidate.id === item.itemId && candidate.itemType === item.itemType));
  const chooseItem = (key: string, index: number, value: string) => {
    if (!parsedDraft) return;
    const next = JSON.parse(JSON.stringify(parsedDraft));
    next[key][index].itemId = value && value !== 'new' ? Number(value) : null;
    next[key][index].createNew = value === 'new';
    setDraft(JSON.stringify(next, null, 2));
  };

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
      {uncertainties.length > 0 && (
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

      {confirmedItems.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
            {t("notes.editor.trackingConfirmed")}
          </h3>
          {confirmedItems.map((item) => (
            <div
              key={String(item.title)}
              className="rounded-md border border-border/40 bg-card px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">{String(item.title)}</span>
                <span className="text-muted-foreground">{String(item.itemType || "")}</span>
              </div>
              {item.state && (
                <p className="mt-1 text-xs text-muted-foreground">{String(item.state)}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {confirmedUpdates.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
            {t("notes.editor.trackingConfirmed")}
          </h3>
          {confirmedUpdates.map((update) => (
            <div key={update.id} className="rounded-md border border-border/40 bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">{update.item_title}</span>
                <span className="text-muted-foreground">{update.update_type}</span>
              </div>
              <p className="mt-1 text-sm text-foreground/80">{update.content}</p>
              {update.evidence_text && (
                <p className="mt-1 text-xs text-muted-foreground">“{update.evidence_text}”</p>
              )}
            </div>
          ))}
        </section>
      )}

      {latest && latest.status === "pending" && (
        <section className="space-y-2 border-t border-border/40 pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
              {t("notes.editor.trackingPending")}
            </h3>
            <span className="text-[11px] text-muted-foreground">#{latest.id}</span>
          </div>
          {draftItems.map(({key, index, item}) => (
            <label key={`${key}:${index}`} className="block rounded-md border border-border/50 bg-card p-3 text-sm">
              <span className="block font-medium">{String(item.title)} · {String(item.itemType)}</span>
              <span className="mt-2 block text-xs text-muted-foreground">{t('notes.trackingIdentity.assignment')}</span>
              <select
                aria-label={`${t('notes.trackingIdentity.assignment')}: ${String(item.title)}`}
                className="mt-1 w-full rounded-md border border-border bg-background p-2"
                value={item.createNew === true ? 'new' : candidates.some(c => c.id === item.itemId && c.itemType === item.itemType) ? String(item.itemId) : ''}
                onChange={event => chooseItem(key, index, event.target.value)}
              >
                <option value="">{t('notes.trackingIdentity.choose')}</option>
                {candidates.filter(c => c.itemType === item.itemType).map(c => <option key={c.id} value={c.id}>
                  #{c.id} · {c.title}{c.linked ? ` · ${t('notes.trackingIdentity.linked')}` : ''}
                </option>)}
                <option value="new">{t('notes.trackingIdentity.create')}</option>
              </select>
            </label>
          ))}
          {!resolved && <p className="text-xs text-amber-600" role="status">{t('notes.trackingIdentity.required')}</p>}
          <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('notes.trackingIdentity.details')}</summary>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-48 w-full resize-y rounded-md border border-border/50 bg-card px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-ring/60"
            aria-label={t("notes.editor.trackingPending")}
          />
          </details>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onReject(latest.id)}
              className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted"
            >
              <X size={13} />
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => parsedDraft && onConfirm(latest.id, parsedDraft)}
              disabled={!resolved || isExtracting}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Check size={13} />
              {t("common.save")}
            </button>
          </div>
        </section>
      )}
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
