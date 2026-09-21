import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import type {
  TrackingDetail,
  TrackingItem,
  TrackingItemPatch,
  TrackingList,
  TrackingQuery,
  TrackingTemplate,
} from "../types/tracking";

type Editor = {
  expected: TrackingItem;
  title: string;
  state: string;
  isActive: boolean;
  values: Record<string, string>;
  removed: string[];
};
const field =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function TrackingCenter({
  active,
  request,
  onOpenNote,
}: {
  active: boolean;
  request: { id: number; serial: number } | null;
  onOpenNote: (id: number, folderId: number | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"items" | "templates">("items");
  const [query, setQuery] = useState<TrackingQuery>({ page: 1, active: "all" });
  const [list, setList] = useState<TrackingList | null>(null);
  const [templates, setTemplates] = useState<TrackingTemplate[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<TrackingDetail | null>(null);
  const [page, setPage] = useState(1);
  const [updateType, setUpdateType] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [saved, setSaved] = useState(false);

  const patch: TrackingItemPatch = {};
  if (editor) {
    if (editor.title.trim() !== editor.expected.title) patch.title = editor.title.trim();
    if (editor.state !== editor.expected.state) patch.state = editor.state;
    if (editor.isActive !== editor.expected.isActive) patch.isActive = editor.isActive;
    const properties = Object.fromEntries(
      Object.entries(editor.values).filter(
        ([key, value]) => !editor.removed.includes(key) && value !== editor.expected.properties[key]
      )
    );
    if (Object.keys(properties).length) patch.properties = properties;
    if (editor.removed.length) patch.removePropertyKeys = editor.removed;
  }
  const dirty = Object.keys(patch).length > 0;
  const canLeave = useCallback(() => {
    if (saveLock.current) return false;
    if (dirty && !window.confirm(t("trackingCenter.discard"))) return false;
    setEditor(null);
    setReview(false);
    return true;
  }, [dirty, t]);

  useEffect(() => {
    if (!active) return;
    const guard = (event: Event) => {
      if (!canLeave()) event.preventDefault();
    };
    const close = (event: BeforeUnloadEvent) => {
      if (dirty || saveLock.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("superting-before-navigation", guard);
    window.addEventListener("beforeunload", close);
    return () => {
      window.removeEventListener("superting-before-navigation", guard);
      window.removeEventListener("beforeunload", close);
    };
  }, [active, canLeave, dirty]);

  useEffect(() => {
    if (request) {
      setSelected(request.id);
      setPage(1);
      setUpdateType("");
      setTab("items");
    }
  }, [request]);
  useEffect(() => {
    const listener = () => setRefresh((value) => value + 1);
    window.addEventListener("superting-tracking-updated", listener);
    return () => window.removeEventListener("superting-tracking-updated", listener);
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      Promise.all([
        window.electronAPI.listTrackingItems(query),
        window.electronAPI.getTrackingTemplates(),
      ])
        .then(([items, definitions]) => {
          if (!cancelled) {
            setList(items);
            setTemplates(definitions as unknown as TrackingTemplate[]);
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query, refresh]);
  useEffect(() => {
    if (!active || selected === null || editor) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError("");
    setDetail(null);
    window.electronAPI
      .getTrackingItemDetail(selected, { page, updateType, ...range })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((reason) => {
        if (!cancelled) setDetailError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, selected, page, updateType, range, refresh, editor]);

  const select = (id: number | null) => {
    if (!canLeave()) return;
    setSelected(id);
    setDetail(null);
    setPage(1);
    setUpdateType("");
    setSaved(false);
  };
  const filter = (next: TrackingQuery) =>
    setQuery((previous) => ({ ...previous, ...next, page: 1 }));
  const beginEdit = () => {
    if (!detail) return;
    setSaved(false);
    setDetailError("");
    setEditor({
      expected: detail.item,
      title: detail.item.title,
      state: detail.item.state,
      isActive: detail.item.isActive,
      values: Object.fromEntries(
        Object.entries(detail.item.properties).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      ),
      removed: [],
    });
  };
  const save = async () => {
    if (!editor || !dirty || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setDetailError("");
    try {
      const result = await window.electronAPI.updateTrackingItem(editor.expected.id, {
        expected: editor.expected,
        patch,
      });
      if (!result.success || !result.data)
        throw new Error(result.error || t("trackingCenter.failed"));
      setDetail(result.data);
      setEditor(null);
      setReview(false);
      setSaved(true);
      window.dispatchEvent(new CustomEvent("superting-tracking-updated"));
    } catch (reason) {
      setDetailError(String(reason));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const template = templates.find(
    (entry) => entry.id === (editor?.expected.template_id ?? detail?.item.template_id)
  );
  const display = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  const pagination = (current: number, total: number, change: (page: number) => void) => (
    <div className="flex items-center justify-between gap-2 py-3 text-xs text-muted-foreground">
      <Button size="sm" variant="ghost" disabled={current <= 1} onClick={() => change(current - 1)}>
        {t("trackingCenter.previous")}
      </Button>
      <span>{t("trackingCenter.page", { page: current, total })}</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={current * 30 >= total}
        onClick={() => change(current + 1)}
      >
        {t("trackingCenter.next")}
      </Button>
    </div>
  );

  return (
    <section className="flex h-full min-h-0 flex-col px-5 pb-5 pt-8 text-foreground">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("trackingCenter.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("trackingCenter.description")}</p>
        </div>
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => {
            if (canLeave()) setRefresh((value) => value + 1);
          }}
        >
          {t("trackingCenter.refresh")}
        </Button>
      </header>
      <div className="mb-4 flex gap-2" role="tablist" aria-label={t("trackingCenter.title")}>
        {(["items", "templates"] as const).map((key) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? "secondary" : "ghost"}
            onClick={() => {
              if (canLeave()) setTab(key);
            }}
          >
            {t(`trackingCenter.${key}`)}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t("trackingCenter.failed")} {error}
        </p>
      )}
      {tab === "templates" ? (
        <div className="grid gap-4 overflow-y-auto md:grid-cols-2">
          {templates.map((entry) => (
            <article key={entry.id} className="rounded-lg border border-border bg-card p-4">
              <h2 className="font-semibold">
                {entry.name} <span className="text-xs text-muted-foreground">v{entry.version}</span>
              </h2>
              {(["fields", "states", "updateTypes"] as const).map((key) => (
                <div key={key} className="mt-3">
                  <h3 className="text-xs text-muted-foreground">{t(`trackingCenter.${key}`)}</h3>
                  <p className="mt-1 text-sm">{entry.definition[key].join(" · ")}</p>
                </div>
              ))}
              <Button
                variant="ghost"
                className="mt-4"
                onClick={() => {
                  filter({ templateId: entry.id, state: "" });
                  setTab("items");
                }}
              >
                {t("trackingCenter.viewItems")}
              </Button>
            </article>
          ))}
          {!loading && !templates.length && !error && <p>{t("trackingCenter.empty")}</p>}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-5">
          <aside
            className={`${selected !== null ? "hidden lg:flex" : "flex"} w-full shrink-0 flex-col lg:w-80`}
          >
            <input
              className={field}
              aria-label={t("trackingCenter.search")}
              placeholder={t("trackingCenter.search")}
              value={query.search || ""}
              onChange={(event) => filter({ search: event.target.value })}
            />
            <div className="my-3 grid grid-cols-2 gap-2">
              <select
                className={field}
                aria-label={t("trackingCenter.templates")}
                value={query.templateId ?? ""}
                onChange={(event) =>
                  filter({
                    templateId: event.target.value ? Number(event.target.value) : null,
                    state: "",
                  })
                }
              >
                <option value="">{t("trackingCenter.allTypes")}</option>
                {templates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <select
                className={field}
                aria-label={t("trackingCenter.state")}
                value={query.state || ""}
                onChange={(event) => filter({ state: event.target.value })}
              >
                <option value="">{t("trackingCenter.allStates")}</option>
                {list?.states.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <select
                className={`${field} col-span-2`}
                aria-label={t("trackingCenter.tracking")}
                value={query.active}
                onChange={(event) =>
                  filter({ active: event.target.value as TrackingQuery["active"] })
                }
              >
                {["all", "active", "inactive"].map((key) => (
                  <option key={key} value={key}>
                    {t(`trackingCenter.${key}`)}
                  </option>
                ))}
              </select>
            </div>
            {loading && (
              <p role="status" className="py-2 text-sm">
                {t("trackingCenter.loading")}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto space-y-2" aria-busy={loading}>
              {!loading && !error && list?.total === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("trackingCenter.empty")}</p>
              )}
              {!error &&
                list?.items.map((item) => (
                  <button
                    key={item.id}
                    disabled={loading}
                    onClick={() => select(item.id)}
                    className={`w-full rounded-lg border p-3 text-left focus-visible:ring-2 focus-visible:ring-ring ${selected === item.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.itemType} · {item.state} ·{" "}
                      {t(item.isActive ? "trackingCenter.active" : "trackingCenter.inactive")}
                    </p>
                    <p className="mt-3 line-clamp-2 text-xs">
                      {item.latestContent || t("trackingCenter.noProgress")}
                    </p>
                    {item.latestRecordedAt && (
                      <time className="mt-1 block text-xs text-muted-foreground">
                        {item.latestRecordedAt}
                      </time>
                    )}
                  </button>
                ))}
            </div>
            {list &&
              pagination(query.page || 1, list.total, (next) =>
                setQuery((previous) => ({ ...previous, page: next }))
              )}
          </aside>
          <main
            className={`${selected === null ? "hidden lg:block" : "block"} min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-5`}
          >
            <Button variant="ghost" className="mb-3 lg:hidden" onClick={() => select(null)}>
              {t("trackingCenter.back")}
            </Button>
            {loadingDetail && <p role="status">{t("trackingCenter.loading")}</p>}
            {detailError && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {t("trackingCenter.failed")} {detailError}
              </p>
            )}
            {saved && (
              <p role="status" className="mb-3 text-sm text-success">
                {t("trackingCenter.saved")}
              </p>
            )}
            {selected === null && (
              <p className="text-sm text-muted-foreground">{t("trackingCenter.select")}</p>
            )}
            {detail && !editor && (
              <>
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{detail.item.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      #{detail.item.id} · {detail.item.itemType} · {detail.item.state}
                    </p>
                  </div>
                  <Button variant="outline" onClick={beginEdit}>
                    {t("trackingCenter.edit")}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("trackingCenter.modified")} {detail.item.updated_at}
                </p>
                <dl className="my-5 grid gap-3 sm:grid-cols-2">
                  {Object.entries(detail.item.properties).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd className="break-words text-sm">{display(value)}</dd>
                    </div>
                  ))}
                </dl>
                <h3 className="mb-2 text-sm font-semibold">{t("trackingCenter.progress")}</h3>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  {(["from", "to"] as const).map((key) => (
                    <label key={key} className="text-xs text-muted-foreground">
                      {t(`trackingCenter.${key}`)}
                      <input
                        className={field}
                        type="date"
                        value={range[key]}
                        onChange={(event) => {
                          setRange({ ...range, [key]: event.target.value });
                          setPage(1);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <select
                  className={`${field} mb-3`}
                  aria-label={t("trackingCenter.updateTypes")}
                  value={updateType}
                  onChange={(event) => {
                    setUpdateType(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t("trackingCenter.allTypes")}</option>
                  {template?.definition.updateTypes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                {detail.updates.items.map((update) => (
                  <article
                    key={update.id}
                    className="mb-3 border-l-2 border-primary/30 pl-3 text-sm"
                  >
                    <p className="text-xs text-muted-foreground">
                      {update.update_type} ·{" "}
                      {update.note_title || t("trackingCenter.missingSource")}
                    </p>
                    <p className="my-2 whitespace-pre-wrap">{update.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("trackingCenter.occurred")}{" "}
                      {update.unknown_date
                        ? `${t("trackingCenter.unknownDate")}${update.occurred_at ? ` (${update.occurred_at})` : ""}`
                        : update.occurred_at}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("trackingCenter.recorded")} {update.created_at}
                    </p>
                    {update.evidence_text && (
                      <blockquote className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                        {update.evidence_text}
                      </blockquote>
                    )}
                  </article>
                ))}
                {!detail.updates.total && (
                  <p className="text-sm text-muted-foreground">{t("trackingCenter.noProgress")}</p>
                )}
                {pagination(page, detail.updates.total, setPage)}
                <h3 className="mt-4 text-sm font-semibold">{t("trackingCenter.relations")}</h3>
                {detail.relations.map((relation) => (
                  <button
                    key={relation.id}
                    className="mt-2 block text-left text-sm text-primary"
                    onClick={() =>
                      select(
                        relation.item_id === selected ? relation.related_item_id : relation.item_id
                      )
                    }
                  >
                    {relation.source_title} → {relation.relation_type} → {relation.target_title}
                    <span className="block text-xs text-muted-foreground">
                      {relation.evidence_text}
                    </span>
                  </button>
                ))}
                <h3 className="mt-5 text-sm font-semibold">{t("trackingCenter.sources")}</h3>
                {detail.notes.map((note) => (
                  <button
                    key={note.id}
                    className="mt-2 block text-sm text-primary disabled:text-muted-foreground"
                    disabled={!!note.deleted_at}
                    onClick={() => onOpenNote(note.id, note.folder_id)}
                  >
                    {note.title || `#${note.id}`}{" "}
                    {note.deleted_at ? t("trackingCenter.missingSource") : ""}
                  </button>
                ))}
                <h3 className="mt-5 text-sm font-semibold">{t("trackingCenter.history")}</h3>
                {detail.operations.map((operation) => (
                  <details key={operation.id} className="mt-2 text-xs">
                    <summary>
                      {operation.created_at} · {t("trackingCenter.edit")}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all">
                      {operation.before_json}
                      {"\n→\n"}
                      {operation.after_json}
                    </pre>
                  </details>
                ))}
              </>
            )}
            {editor && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (review) void save();
                  else setReview(true);
                }}
              >
                <h2 className="text-lg font-semibold">{t("trackingCenter.edit")}</h2>
                <p className="my-3 text-sm text-muted-foreground">{t("trackingCenter.shared")}</p>
                {review ? (
                  <>
                    <h3 className="mb-3 text-sm font-semibold">{t("trackingCenter.review")}</h3>
                    <dl className="space-y-3 text-sm">
                      {Object.entries(patch)
                        .filter(([key]) => key !== "properties" && key !== "removePropertyKeys")
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{t(`trackingCenter.${key === "title" ? "name" : key}`)}</dt>
                            <dd className="break-words">
                              {key === "isActive"
                                ? t(
                                    editor.expected.isActive
                                      ? "trackingCenter.active"
                                      : "trackingCenter.inactive"
                                  )
                                : display(editor.expected[key as keyof TrackingItem])}{" "}
                              →{" "}
                              {key === "isActive"
                                ? t(value ? "trackingCenter.active" : "trackingCenter.inactive")
                                : display(value)}
                            </dd>
                          </div>
                        ))}
                      {Object.entries(patch.properties || {}).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {display(editor.expected.properties[key])} → {display(value)}
                          </dd>
                        </div>
                      ))}
                      {editor.removed.map((key) => (
                        <div key={key}>
                          {key}: {display(editor.expected.properties[key])} →{" "}
                          {t("trackingCenter.removed")}
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <div className="space-y-4">
                    <label className="block text-sm">
                      {t("trackingCenter.name")}
                      <input
                        className={field}
                        required
                        value={editor.title}
                        onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                      />
                    </label>
                    <label className="block text-sm">
                      {t("trackingCenter.state")}
                      <select
                        className={field}
                        value={editor.state}
                        onChange={(event) => setEditor({ ...editor, state: event.target.value })}
                      >
                        {[
                          ...new Set([
                            editor.expected.state,
                            ...(template?.definition.states || []),
                          ]),
                        ].map((state) => (
                          <option key={state}>{state}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editor.isActive}
                        onChange={(event) =>
                          setEditor({ ...editor, isActive: event.target.checked })
                        }
                      />
                      {t("trackingCenter.active")}
                    </label>
                    {[
                      ...new Set([
                        ...(template?.definition.fields || []),
                        ...Object.keys(editor.expected.properties),
                      ]),
                    ].map((key) => (
                      <div key={key} className="flex items-end gap-2">
                        <label className="min-w-0 flex-1 text-sm">
                          {key}
                          {editor.removed.includes(key) ? (
                            <p>{t("trackingCenter.removed")}</p>
                          ) : typeof editor.expected.properties[key] === "object" ||
                            typeof editor.expected.properties[key] === "number" ||
                            typeof editor.expected.properties[key] === "boolean" ? (
                            <pre className="whitespace-pre-wrap text-xs">
                              {display(editor.expected.properties[key])}
                            </pre>
                          ) : (
                            <input
                              className={field}
                              value={editor.values[key] ?? ""}
                              onChange={(event) =>
                                setEditor({
                                  ...editor,
                                  values: { ...editor.values, [key]: event.target.value },
                                })
                              }
                            />
                          )}
                        </label>
                        {Object.hasOwn(editor.expected.properties, key) && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setEditor({
                                ...editor,
                                removed: editor.removed.includes(key)
                                  ? editor.removed.filter((value) => value !== key)
                                  : [...editor.removed, key],
                              })
                            }
                          >
                            {t(
                              editor.removed.includes(key)
                                ? "trackingCenter.undo"
                                : "trackingCenter.remove"
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-6 flex gap-2">
                  <Button type="submit" disabled={saving || !dirty || !editor.title.trim()}>
                    {t(
                      saving
                        ? "trackingCenter.saving"
                        : review
                          ? "trackingCenter.confirm"
                          : "trackingCenter.review"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      if (review) setReview(false);
                      else canLeave();
                    }}
                  >
                    {t(review ? "trackingCenter.back" : "trackingCenter.cancel")}
                  </Button>
                </div>
              </form>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
