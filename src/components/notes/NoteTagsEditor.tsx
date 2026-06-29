import { useEffect, useState } from "react";
import { ChevronDown, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../ui/useToast";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  const allChoices = normalizeTags([...localTags, ...availableTags]);
  const firstTag = localTags[0] || "";
  const remainingTagCount = Math.max(0, localTags.length - 1);
  const isSelected = (tag: string) =>
    localTags.some((localTag) => localTag.toLocaleLowerCase() === tag.toLocaleLowerCase());
  const toggleTag = (tag: string, checked: boolean) => {
    if (checked) {
      void commit([...localTags, tag]);
      return;
    }
    void commit(localTags.filter((item) => item.toLocaleLowerCase() !== tag.toLocaleLowerCase()));
  };
  const checkboxItemClass =
    "text-xs gap-2 rounded-md py-1.5 pl-8 pr-2 [&>span:first-child]:rounded-[3px] [&>span:first-child]:border [&>span:first-child]:border-border [&>span:first-child]:bg-background";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label={t("notes.tags.chooseExisting")}
          title={t("notes.tags.chooseExisting")}
          className="inline-flex h-6 max-w-44 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-background/75 px-2 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-border hover:bg-muted/70 hover:text-foreground disabled:opacity-50 outline-none"
        >
          <Tag size={11} className="shrink-0" aria-hidden="true" />
          {firstTag ? (
            <>
              <span className="min-w-0 truncate text-foreground/80">{firstTag}</span>
              {remainingTagCount > 0 && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  +{remainingTagCount}
                </span>
              )}
            </>
          ) : (
            <span className="min-w-0 truncate">{t("notes.tags.add")}</span>
          )}
          <ChevronDown size={10} className="shrink-0 text-muted-foreground/70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="max-h-64 min-w-48 overflow-y-auto p-1">
        <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {t("notes.tags.chooseExisting")}
        </DropdownMenuLabel>
        {allChoices.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag.toLocaleLowerCase()}
            checked={isSelected(tag)}
            disabled={saving}
            className={checkboxItemClass}
            onCheckedChange={(checked) => toggleTag(tag, Boolean(checked))}
            onSelect={(event) => event.preventDefault()}
          >
            <span className="truncate">{tag}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {allChoices.length > 0 && <DropdownMenuSeparator />}
        <div className="px-1 py-0.5">
          <input
            value={input}
            disabled={saving}
            onChange={(event) => setInput(event.target.value)}
            onBlur={addInput}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addInput();
              }
            }}
            aria-label={t("notes.tags.add")}
            placeholder={t("notes.tags.placeholder")}
            className="input-inline h-7 w-full rounded-md bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
