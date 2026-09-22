import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { TrackingItem } from "../../types/tracking";

export type ItemChoice = Pick<TrackingItem, "id" | "title" | "itemType" | "state">;

export function TrackingItemPicker({
  itemType,
  selected,
  disabled,
  onSelect,
}: {
  itemType: string;
  selected?: ItemChoice;
  disabled?: boolean;
  onSelect: (item: ItemChoice) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    setItems([]);
    const timer = setTimeout(async () => {
      try {
        const templates = await window.electronAPI.getTrackingTemplates();
        const template = templates.find((entry) => entry.name === itemType);
        if (!template || typeof template.id !== "number")
          throw new Error(t("trackingReview.unknownType"));
        const result = await window.electronAPI.listTrackingItems({
          search,
          templateId: template.id,
          page,
        });
        if (alive) {
          setItems(result.items);
          setTotal(result.total);
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, search, page, itemType, t]);
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setSearch("");
          setPage(1);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between gap-2 whitespace-normal text-left shadow-none"
          aria-label={t("trackingUI.assignment")}
        >
          <span className="min-w-0 break-words">
            {selected
              ? `#${selected.id} · ${selected.title} · ${selected.state}`
              : t("trackingBatch.search")}
          </span>
          <ChevronDown size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] flex-col overflow-hidden p-2"
        aria-label={t("trackingBatch.search")}
      >
        <div className="relative shrink-0">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="h-10 pl-9 shadow-none"
            value={search}
            aria-label={t("trackingBatch.search")}
            placeholder={t("trackingBatch.search")}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              setItems([]);
              setLoading(true);
            }}
          />
        </div>
        <div className="mt-2 min-h-0 max-h-64 overflow-y-auto" aria-busy={loading}>
          {loading ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              {t("trackingCenter.loading")}
            </p>
          ) : error ? (
            <p role="alert" className="p-3 text-sm text-destructive">
              {error}
            </p>
          ) : !items.length ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              {t("trackingCenter.empty")}
            </p>
          ) : (
            items.map((item) => (
              <button
                type="button"
                key={item.id}
                className="flex w-full items-start gap-2 rounded-md p-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <Check
                  size={15}
                  aria-hidden
                  className={
                    selected?.id === item.id
                      ? "mt-0.5 shrink-0 text-primary"
                      : "mt-0.5 shrink-0 invisible"
                  }
                />
                <span className="min-w-0 break-words">
                  {item.title}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    #{item.id} · {item.state}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        {!loading && !error && (page > 1 || total > items.length) && (
          <div className="mt-2 flex shrink-0 justify-between border-t border-border pt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t("trackingCenter.previous")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page * 30 >= total}
              onClick={() => setPage(page + 1)}
            >
              {t("trackingCenter.next")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
