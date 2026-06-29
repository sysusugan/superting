import { useEffect, useState } from "react";
import { Tag, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../ui/useToast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface NoteTagsEditorProps {
  tags: string[];
  availableTags?: string[];
  onChange: (tags: string[]) => Promise<void>;
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.reduce<string[]>((result, value) => {
    const name = value.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return result;
    seen.add(key);
    result.push(name);
    return result;
  }, []);
}

export default function NoteTagsEditor({ tags, availableTags = [], onChange }: NoteTagsEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [localTags, setLocalTags] = useState(tags);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setLocalTags(tags), [tags]);

  const commit = async (nextTags: string[]) => {
    const normalized = normalizeTags(nextTags);
    const previous = localTags;
    setLocalTags(normalized);
    setSaving(true);
    try {
      await onChange(normalized);
    } catch {
      setLocalTags(previous);
      toast({ title: t("notes.tags.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addInput = () => {
    const values = input.split(",");
    if (!values.some((value) => value.trim())) return;
    setInput("");
    void commit([...localTags, ...values]);
  };
  const existingChoices = normalizeTags(availableTags).filter(
    (tag) =>
      !localTags.some((localTag) => localTag.toLocaleLowerCase() === tag.toLocaleLowerCase())
  );

  return (
    <div className="inline-flex min-h-6 max-w-full flex-wrap items-center gap-1 rounded-md border border-border/70 bg-background/75 px-1.5 py-0.5">
      <Tag size={11} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      {localTags.map((tag) => (
        <span
          key={tag.toLocaleLowerCase()}
          className="inline-flex h-5 max-w-36 items-center gap-0.5 rounded bg-muted px-1.5 text-[11px] font-medium text-foreground/80"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit(localTags.filter((item) => item !== tag))}
            aria-label={t("notes.tags.remove", { tag })}
            title={t("notes.tags.remove", { tag })}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <input
        value={input}
        disabled={saving}
        onChange={(event) => setInput(event.target.value)}
        onBlur={addInput}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addInput();
          }
        }}
        aria-label={t("notes.tags.add")}
        placeholder={localTags.length === 0 ? t("notes.tags.add") : t("notes.tags.placeholder")}
        className="h-5 min-w-16 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
      />
      {existingChoices.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={saving}
              aria-label={t("notes.tags.chooseExisting")}
              title={t("notes.tags.chooseExisting")}
              className="inline-flex h-5 shrink-0 items-center rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Tag size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="max-h-56 min-w-32 overflow-y-auto p-1">
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("notes.tags.chooseExisting")}
            </DropdownMenuLabel>
            {existingChoices.map((tag) => (
              <DropdownMenuItem
                key={tag.toLocaleLowerCase()}
                className="text-xs"
                onSelect={() => void commit([...localTags, tag])}
              >
                {tag}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
