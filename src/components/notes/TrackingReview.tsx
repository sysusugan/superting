import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { TrackingItemPicker, type ItemChoice } from "../tracking/TrackingItemPicker";
import { removeDraftItem } from "../tracking/removeDraftItem";
import {
  TrackingItemCard,
  TrackingProgressList,
  TrackingProgressEntry,
} from "../tracking/TrackingCards";
import { groupTrackingUpdates } from "../tracking/groupTrackingUpdates";

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
  const [chosenMatches, setChosenMatches] = useState<ItemChoice[]>([]);
  const [undoDraft, setUndoDraft] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    setDraft(JSON.stringify(latest?.reviewResult || latest?.result || {}, null, 2));
    setReplace(false);
    setError("");
    setChosenMatches([]);
    setUndoDraft(null);
  }, [latest?.id, latest?.reviewResult, latest?.result]);
  if (!latest || latest.status !== "pending") return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(draft);
    const record = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v);
    if (
      record(value) &&
      Array.isArray(value.updates) &&
      ["matchedItems", "newItems", "updates", "uncertainties", "relations"].every(
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
  const candidates = [...chosenMatches, ...(data.candidates || [])];
  const resolved =
    parsed &&
    items.every(
      (item) =>
        item.createNew === true ||
        candidates.some((c) => c.id === item.itemId && c.itemType === item.itemType)
    );
  const choose = (ref: string, selected?: ItemChoice) => {
    if (!parsed) return;
    setUndoDraft(null);
    if (selected)
      setChosenMatches((previous) => [
        ...previous.filter((item) => item.id !== selected.id),
        selected,
      ]);
    for (const key of ["matchedItems", "newItems"])
      for (const item of (parsed[key] || []) as DraftItem[])
        if (item.ref === ref) {
          item.createNew = !selected;
          item.itemId = selected?.id ?? null;
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
      {undoDraft !== null && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <span>{t("trackingReview.removed")}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || disabled}
            onClick={() => {
              setDraft(undoDraft);
              setUndoDraft(null);
            }}
          >
            {t("trackingCenter.undo")}
          </Button>
        </div>
      )}
      {groups.map(({ item, updates: entries }) => (
        <TrackingItemCard
          key={item.ref}
          title={item.title}
          itemType={item.itemType}
          state={item.state}
          properties={item.properties}
          actions={
            <>
              <Button
                size="sm"
                variant={item.createNew ? "secondary" : "ghost"}
                aria-pressed={!!item.createNew}
                disabled={disabled || saving}
                onClick={() => choose(item.ref)}
              >
                <Plus size={14} aria-hidden />
                {t(item.createNew ? "trackingReview.willCreate" : "trackingReview.create")}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                disabled={disabled || saving}
                aria-label={t("trackingReview.remove", { title: item.title })}
                title={t("trackingReview.remove", { title: item.title })}
                onClick={() => {
                  if (!parsed) return;
                  setUndoDraft(draft);
                  setDraft(JSON.stringify(removeDraftItem(parsed, item.ref), null, 2));
                }}
              >
                <X size={16} aria-hidden />
              </Button>
            </>
          }
          controls={
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t(item.createNew ? "trackingReview.createHint" : "trackingUI.assignment")}
              </p>
              <TrackingItemPicker
                itemType={item.itemType}
                selected={candidates.find((candidate) => candidate.id === item.itemId)}
                disabled={disabled || saving}
                onSelect={(selected) => choose(item.ref, selected)}
              />
            </div>
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
          disabled={disabled || saving}
          onChange={(e) => {
            setUndoDraft(null);
            setDraft(e.target.value);
          }}
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
