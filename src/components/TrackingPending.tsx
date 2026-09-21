import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import TrackingReview, { type ReviewData } from "./notes/TrackingReview";
import { Button } from "./ui/button";
import type { PendingTrackingList } from "../types/tracking";

export default function TrackingPending({
  onOpenNote,
  onExtract,
  onCount,
}: {
  onOpenNote: (id: number, folder: number | null) => void;
  onExtract: (note: { id: number; recordedAt: string }) => void;
  onCount: (count: number) => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [list, setList] = useState<PendingTrackingList | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<ReviewData | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const listener = () => setRevision((v) => v + 1);
    window.addEventListener("superting-tracking-updated", listener);
    return () => window.removeEventListener("superting-tracking-updated", listener);
  }, []);
  useEffect(() => {
    let alive = true;
    window.electronAPI
      .listPendingTrackingNotes({ page })
      .then((r) => {
        if (!alive) return;
        setList(r);
        onCount(r.total);
        if (!r.items.length && page > 1) {
          setPage(page - 1);
          return;
        }
        setSelected((id) => (r.items.some((n) => n.id === id) ? id : (r.items[0]?.id ?? null)));
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [page, revision, onCount]);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    if (selected)
      window.electronAPI
        .getNoteTracking(selected)
        .then((r) => {
          if (alive) setData(r as ReviewData);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    return () => {
      alive = false;
    };
  }, [selected, revision]);
  const current = list?.items.find((n) => n.id === selected);
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-auto md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="max-h-64 space-y-2 overflow-auto pr-2 md:max-h-none">
        {list?.items.map((n) => (
          <button
            key={n.id}
            className={
              "block w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (selected === n.id
                ? "border-primary/40 bg-primary/5 shadow-sm"
                : "border-transparent bg-muted/30 hover:bg-muted/60")
            }
            aria-pressed={selected === n.id}
            onClick={() => setSelected(n.id)}
          >
            <strong className="block break-words text-sm font-semibold leading-relaxed">
              {n.title}
            </strong>
            <p className="mt-1 text-xs text-muted-foreground">{n.recordedAt}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("trackingBatch.counts", { items: n.itemCount, updates: n.updateCount })}
            </p>
            {n.stale && (
              <p className="mt-1 text-xs text-muted-foreground">{t("trackingBatch.stale")}</p>
            )}
          </button>
        ))}
        {list?.total === 0 && <p>{t("trackingBatch.noPending")}</p>}
        <div className="flex justify-between">
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            {t("trackingCenter.previous")}
          </Button>
          <Button disabled={!list || page * 50 >= list.total} onClick={() => setPage(page + 1)}>
            {t("trackingCenter.next")}
          </Button>
        </div>
      </aside>
      <div className="min-w-0 space-y-5 overflow-auto px-1 pb-4">
        {error && <p role="alert">{error}</p>}
        {current && (
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background py-3">
            <h2 className="min-w-0 flex-1 break-words text-base font-semibold">{current.title}</h2>
            <Button variant="outline" onClick={() => onOpenNote(current.id, current.folder_id)}>
              {t("trackingBatch.openNote")}
            </Button>
            {current.stale && (
              <Button onClick={() => onExtract(current)}>{t("trackingBatch.extract")}</Button>
            )}
          </div>
        )}
        {current && !data && !error && (
          <div role="status" className="space-y-3">
            <span className="sr-only">{t("common.loading")}</span>
            <div className="h-32 rounded-xl bg-muted motion-safe:animate-pulse" />
            <div className="ml-6 h-24 rounded-lg bg-muted/50 motion-safe:animate-pulse" />
          </div>
        )}
        {data && (
          <TrackingReview key={selected} data={data} onSaved={() => setRevision((v) => v + 1)} />
        )}
      </div>
    </div>
  );
}
