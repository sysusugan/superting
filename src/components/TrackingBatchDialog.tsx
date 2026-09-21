import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import {
  runTrackingBatch,
  stopTrackingBatch,
  useActionProcessingStore,
} from "../stores/actionProcessingStore";
import {
  useSettingsStore,
  selectResolvedNoteFormatting,
  selectIsCloudNoteFormattingMode,
} from "../stores/settingsStore";
import type { ActionItem } from "../types/electron";
import type { TrackingSourceNote } from "../types/tracking";

function dateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
function rangeFor(days: number) {
  const end = new Date(),
    start = new Date();
  start.setDate(start.getDate() - days + 1);
  return { from: dateValue(start), to: dateValue(end) };
}
export default function TrackingBatchDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: { id: number; recordedAt: string } | null;
}) {
  const { t } = useTranslation();
  const batch = useActionProcessingStore((s) => s.batch);
  const settings = useSettingsStore();
  const resolved = selectResolvedNoteFormatting(settings);
  const isCloudMode = selectIsCloudNoteFormattingMode(settings);
  const [range, setRange] = useState(() => rangeFor(7));
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [actionId, setActionId] = useState("");
  const [rows, setRows] = useState<TrackingSourceNote[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [force, setForce] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [targetId, setTargetId] = useState<number | null>(null);
  useEffect(() => {
    if (open && target && !batch.running) {
      const date = dateValue(new Date(target.recordedAt));
      setRange({ from: date, to: date });
      setForce(true);
      setTargetId(target.id);
    } else if (!target) {
      setTargetId(null);
    }
  }, [open, target, batch.running]);
  useEffect(() => {
    if (!open) return;
    window.electronAPI
      .getActions()
      .then((all) => {
        const available = all.filter((a) => a.output_target === "tracking");
        setActions(available);
        setActionId((id) =>
          available.length === 1
            ? String(available[0].id)
            : available.some((a) => String(a.id) === id)
              ? id
              : ""
        );
      })
      .catch((e) => setError(String(e)));
  }, [open]);
  useEffect(() => {
    if (!open || batch.running || !actionId) return;
    let alive = true;
    setLoading(true);
    setError("");
    setRows([]);
    setSelected(new Set());
    setPage(1);
    const from = new Date(range.from + "T00:00:00"),
      to = new Date(range.to + "T00:00:00");
    to.setDate(to.getDate() + 1);
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to) {
      setLoading(false);
      setError(t("trackingBatch.invalidRange"));
      return;
    }
    window.electronAPI
      .listTrackingSourceNotes({
        from: from.toISOString(),
        to: to.toISOString(),
        actionId: Number(actionId),
        selection: true,
      })
      .then((r) => {
        if (alive) {
          setRows(r.items);
          setSelected(
            new Set(
              r.items
                .filter((n) => n.eligible && (targetId == null || n.id === targetId))
                .map((n) => n.id)
            )
          );
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, range, actionId, batch.running, revision, t, targetId]);
  const action = actions.find((a) => a.id === Number(actionId));
  const chosen = rows.filter((n) => selected.has(n.id));
  const reused = force ? 0 : chosen.filter((n) => n.status === "pending").length;
  const skipped = force ? 0 : chosen.filter((n) => n.status === "confirmed").length;
  const start = (notes: { id: number; title: string }[]) => {
    if (!action) return;
    void runTrackingBatch(
      notes,
      action,
      {
        forceTracking: force,
        modelId: resolved.model,
        isCloudMode,
        speakerLabels: { you: t("notes.speaker.you"), them: t("notes.speaker.them") },
      },
      {
        noModel: t("notes.actions.errors.noModel"),
        actionFailed: t("notes.actions.errors.actionFailed"),
      }
    );
  };
  const eligible = rows.filter((n) => n.eligible);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl gap-3 overflow-y-auto p-4">
        <DialogTitle>{t("trackingBatch.extract")}</DialogTitle>
        <DialogDescription>{t("trackingBatch.description")}</DialogDescription>
        <fieldset disabled={batch.running} className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setTargetId(null);
              setRange(rangeFor(7));
            }}
          >
            {t("trackingBatch.seven")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setTargetId(null);
              setRange(rangeFor(30));
            }}
          >
            {t("trackingBatch.thirty")}
          </Button>
          <label>
            {t("trackingBatch.from")}
            <input
              type="date"
              value={range.from}
              onChange={(e) => {
                setTargetId(null);
                setRange({ ...range, from: e.target.value });
              }}
            />
          </label>
          <label>
            {t("trackingBatch.to")}
            <input
              type="date"
              value={range.to}
              onChange={(e) => {
                setTargetId(null);
                setRange({ ...range, to: e.target.value });
              }}
            />
          </label>
          {actions.length > 1 && (
            <select
              aria-label={t("trackingBatch.action")}
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
            >
              <option value="">{t("trackingBatch.action")}</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </fieldset>
        {!action && <p>{t("notes.editor.trackingUnavailable")}</p>}
        {(!resolved.model || isCloudMode) && <p role="alert">{t("trackingBatch.noModel")}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!batch.running && (
          <>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={!!eligible.length && selected.size === eligible.length}
                onChange={(e) =>
                  setSelected(new Set(e.target.checked ? eligible.map((n) => n.id) : []))
                }
              />
              {t("trackingBatch.selectAll", { selected: selected.size, total: rows.length })}
            </label>
            <div className="max-h-[24vh] space-y-2 overflow-auto">
              {rows.slice((page - 1) * 50, page * 50).map((n) => (
                <label className="flex items-start gap-2 rounded border p-2" key={n.id}>
                  <input
                    type="checkbox"
                    disabled={!n.eligible}
                    checked={selected.has(n.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(n.id);
                        else next.delete(n.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    {n.title}
                    <span className="block text-xs text-muted-foreground">
                      {n.recordedAt} · {t("trackingBatch.status." + n.status)}
                      {!n.eligible && " · " + t("trackingBatch.noContent")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-between">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t("trackingCenter.previous")}
              </Button>
              <span>{page}</span>
              <Button disabled={page * 50 >= rows.length} onClick={() => setPage(page + 1)}>
                {t("trackingCenter.next")}
              </Button>
            </div>
            <label className="flex gap-2">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {t("trackingBatch.force")}
            </label>
            <p>
              {t("trackingBatch.preview", {
                extract: chosen.length - reused - skipped,
                reused,
                skipped,
              })}
            </p>
            <Button
              disabled={loading || !action || !selected.size || !resolved.model || isCloudMode}
              onClick={() => start(chosen)}
            >
              {t("trackingBatch.start")}
            </Button>
          </>
        )}
        {!!batch.entries.length && (
          <section className="space-y-2">
            <p role="status">
              {t("trackingBatch.progress", {
                done: batch.entries.filter((e) => !["queued", "processing"].includes(e.status))
                  .length,
                total: batch.entries.length,
                failed: batch.entries.filter((e) => e.status === "failed").length,
              })}
            </p>
            <div className="max-h-48 overflow-auto">
              {batch.entries.map((e) => (
                <p key={e.id}>
                  {e.title} · {t("trackingBatch.status." + e.status)} {e.error}
                </p>
              ))}
            </div>
            {batch.running ? (
              <Button disabled={batch.stopped} onClick={stopTrackingBatch}>
                {t("trackingBatch.stop")}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  disabled={
                    !action ||
                    !resolved.model ||
                    isCloudMode ||
                    !batch.entries.some((e) => ["failed", "busy"].includes(e.status))
                  }
                  onClick={() =>
                    start(batch.entries.filter((e) => ["failed", "busy"].includes(e.status)))
                  }
                >
                  {t("trackingBatch.retry")}
                </Button>
                <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
                  {t("trackingCenter.refresh")}
                </Button>
              </div>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
