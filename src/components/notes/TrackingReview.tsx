import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import {
  TrackingItemCard,
  TrackingProgressList,
  TrackingProgressEntry,
} from "../tracking/TrackingCards";
import { groupTrackingUpdates } from "../tracking/groupTrackingUpdates";
import type { TrackingItem } from "../../types/tracking";

export interface ReviewData {
  noteId?: number;
  reviewSnapshot?: string;
  updates?: unknown[];
  candidates?: Array<{ id: number; title: string; itemType: string; state: string }>;
  extractions?: Array<{
    id: number;
    status: string;
    stale?: boolean;
    result?: Record<string, unknown> | null;
    reviewResult?: Record<string, unknown> | null;
  }>;
}
type DraftItem = {
  ref: string;
  title: string;
  itemType: string;
  itemId?: number | null;
  createNew?: boolean;
  state?: string;
  properties?: Record<string, unknown>;
};
export default function TrackingReview({
  data,
  onSaved,
  disabled = false,
}: {
  data: ReviewData;
  onSaved: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const latest = data.extractions?.[0];
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<TrackingItem[]>([]);
  const [chosenMatches, setChosenMatches] = useState<TrackingItem[]>([]);
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    setDraft(JSON.stringify(latest?.reviewResult || latest?.result || {}, null, 2));
    setReplace(false);
    setError("");
    setChosenMatches([]);
  }, [latest?.id, latest?.reviewResult, latest?.result]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      window.electronAPI
        .listTrackingItems({ search, page: 1 })
        .then((r) => {
          if (alive) setMatches(r.items);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, latest?.id]);
  if (!latest || latest.status !== "pending") return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(draft);
    const record = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v);
    if (
      record(value) &&
      Array.isArray(value.updates) &&
      ["matchedItems", "newItems", "updates", "uncertainties"].every(
        (key) => value[key] == null || (Array.isArray(value[key]) && value[key].every(record))
      ) &&
      [
        ...((value.matchedItems as Record<string, unknown>[]) || []),
        ...((value.newItems as Record<string, unknown>[]) || []),
      ].every(
        (item) =>
          typeof item.ref === "string" &&
          typeof item.title === "string" &&
          typeof item.itemType === "string"
      )
    )
      parsed = value;
  } catch {
    /* User may be editing advanced JSON. */
  }
  const items = [
    ...(Array.isArray(parsed?.matchedItems) ? parsed.matchedItems : []),
    ...(Array.isArray(parsed?.newItems) ? parsed.newItems : []),
  ] as DraftItem[];
  const candidates = [...(data.candidates || []), ...matches, ...chosenMatches];
  const resolved =
    parsed &&
    items.every(
      (item) =>
        item.createNew === true ||
        candidates.some((c) => c.id === item.itemId && c.itemType === item.itemType)
    );
  const choose = (ref: string, value: string) => {
    if (!parsed) return;
    const selected = matches.find((item) => item.id === Number(value));
    if (selected)
      setChosenMatches((previous) => [
        ...previous.filter((item) => item.id !== selected.id),
        selected,
      ]);
    for (const key of ["matchedItems", "newItems"])
      for (const item of (parsed[key] || []) as DraftItem[])
        if (item.ref === ref) {
          item.createNew = value === "new";
          item.itemId = value === "new" || !value ? null : Number(value);
        }
    setDraft(JSON.stringify(parsed, null, 2));
  };
  const save = async (reject: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const response = reject
        ? await window.electronAPI.rejectTrackingExtraction(latest.id)
        : await window.electronAPI.confirmTrackingExtraction(latest.id, parsed!, {
            expected: data.reviewSnapshot || "",
            replaceUpdates: replace,
          });
      if (!response.success) throw new Error(response.error || t("trackingCenter.failed"));
      window.dispatchEvent(new CustomEvent("superting-tracking-updated", { detail: data.noteId }));
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const updates = Array.isArray(parsed?.updates)
    ? (parsed.updates as Record<string, unknown>[])
    : [];
  const { groups, unassigned } = groupTrackingUpdates(
    items,
    updates,
    (item) => item.ref,
    (update) => (typeof update.itemRef === "string" ? update.itemRef : undefined)
  );
  const progress = (entries: Record<string, unknown>[]) => (
    <TrackingProgressList>
      {entries.map((u, index) => (
        <TrackingProgressEntry
          key={index}
          type={String(u.updateType || "")}
          content={String(u.content || "")}
          date={String(u.occurredAt || "")}
          evidence={String(u.evidence || "")}
        />
      ))}
    </TrackingProgressList>
  );
  return (
    <section className="space-y-5">
      {latest.stale && <p role="alert">{t("trackingBatch.stale")}</p>}
      <label className="block space-y-2 text-xs font-medium text-muted-foreground">
        <span>{t("trackingBatch.search")}</span>
        <input
          className="w-full rounded border bg-background p-2"
          aria-label={t("trackingBatch.search")}
          placeholder={t("trackingBatch.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {groups.map(({ item, updates: entries }) => (
        <TrackingItemCard
          key={item.ref}
          title={item.title}
          itemType={item.itemType}
          state={item.state}
          properties={item.properties}
          controls={
            <label className="block text-xs font-medium text-muted-foreground">
              {t("trackingUI.assignment")}
              <select
                className="mt-2 w-full rounded-lg border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={item.title}
                value={item.createNew ? "new" : item.itemId || ""}
                onChange={(e) => choose(item.ref, e.target.value)}
              >
                <option value="">{t("notes.trackingIdentity.choose")}</option>
                {[
                  ...new Map(
                    candidates.filter((c) => c.itemType === item.itemType).map((c) => [c.id, c])
                  ).values(),
                ].map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.id} · {c.title} · {c.state}
                  </option>
                ))}
                <option value="new">{t("notes.trackingIdentity.create")}</option>
              </select>
            </label>
          }
        >
          {entries.length ? (
            progress(entries)
          ) : (
            <p className="text-xs text-muted-foreground">{t("trackingCenter.noProgress")}</p>
          )}
        </TrackingItemCard>
      ))}
      {!items.length && !updates.length && <p>{t("trackingBatch.empty")}</p>}
      {!!unassigned.length && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("trackingUI.unassigned")}</h3>
          {progress(unassigned)}
        </section>
      )}
      {Array.isArray(parsed?.uncertainties) && parsed.uncertainties.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <h3 className="font-semibold">{t("notes.trackingStatus.uncertainties")}</h3>
          {parsed.uncertainties.map((u: { content?: string; evidence?: string }, i: number) => (
            <p key={i}>
              {String(u.content || "")} {String(u.evidence || "")}
            </p>
          ))}
        </div>
      )}
      <details>
        <summary>{t("notes.trackingIdentity.details")}</summary>
        <textarea
          className="min-h-48 w-full rounded border bg-background p-2 font-mono text-xs"
          value={draft}
          aria-label={t("notes.editor.trackingPending")}
          onChange={(e) => setDraft(e.target.value)}
        />
      </details>
      <p>
        {t("trackingBatch.impact", {
          created: items.filter((i) => i.createNew).length,
          linked: items.filter((i) => i.itemId).length,
          replaced: data.updates?.length || 0,
        })}
      </p>
      {!!data.updates?.length && (
        <label className="flex gap-2">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          {t("trackingBatch.replace")}
        </label>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={saving} onClick={() => void onSaved()}>
          {t("trackingCenter.refresh")}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={() => void save(true)}>
          {t("trackingBatch.reject")}
        </Button>
        <Button
          disabled={
            disabled ||
            saving ||
            !!latest.stale ||
            !resolved ||
            (!!data.updates?.length && !replace)
          }
          onClick={() => void save(false)}
        >
          {t("trackingBatch.confirm")}
        </Button>
      </div>
    </section>
  );
}
