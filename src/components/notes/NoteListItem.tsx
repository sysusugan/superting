import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  MoreHorizontal,
  FolderOpen,
  Trash2,
  Check,
  Loader2,
  Plus,
  Search,
  ExternalLink,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { cn } from "../lib/utils";
import type { NoteItem, FolderItem } from "../../types/electron";
import { normalizeDbDate } from "../../utils/dateFormatting";
import { useActionProcessingStore } from "../../stores/actionProcessingStore";

const RE_HEADING = /#{1,6}\s+/g;
const RE_EMPHASIS = /[*_~`]+/g;
const RE_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const RE_IMAGE = /!\[([^\]]*)\]\([^)]+\)/g;
const RE_BLOCKQUOTE = />\s+/g;
const RE_NEWLINES = /\n+/g;

interface NoteListItemProps {
  note: NoteItem;
  isActive: boolean;
  onClick: () => void;
  onDelete: (id: number) => void;
  folders: FolderItem[];
  currentFolderId: number | null;
  onMoveToFolder: (noteId: number, folderId: number) => void;
  onCreateFolderAndMove: (noteId: number, folderName: string) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelected?: (id: number) => void;
  dragHandlers?: {
    draggable: true;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  isDragging?: boolean;
  noteFilesEnabled?: boolean;
  timestamp?: string;
}

function stripMarkdown(text: string): string {
  return text
    .replace(RE_HEADING, "")
    .replace(RE_EMPHASIS, "")
    .replace(RE_LINK, "$1")
    .replace(RE_IMAGE, "$1")
    .replace(RE_BLOCKQUOTE, "")
    .replace(RE_NEWLINES, " ")
    .trim();
}

function relativeTime(
  dateStr: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const date = normalizeDbDate(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return t("notes.list.timeNow");
  if (minutes < 60) return t("notes.list.minutesAgo", { count: minutes });
  if (hours < 24) return t("notes.list.hoursAgo", { count: hours });
  if (days < 7) return t("notes.list.daysAgo", { count: days });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NoteListItem({
  note,
  isActive,
  onClick,
  onDelete,
  folders,
  currentFolderId,
  onMoveToFolder,
  onCreateFolderAndMove,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelected,
  dragHandlers,
  isDragging,
  noteFilesEnabled,
  timestamp,
}: NoteListItemProps) {
  const { t } = useTranslation();
  const preview = stripMarkdown(note.content);
  const actionState = useActionProcessingStore((state) => state.noteStates[note.id] ?? null);
  const isProcessingAction = actionState?.status === "processing";
  const [folderSearch, setFolderSearch] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const fileManagerName = navigator.platform.startsWith("Mac")
    ? "Finder"
    : navigator.platform.startsWith("Win")
      ? "Explorer"
      : "Files";

  const filteredFolders = useMemo(
    () =>
      folderSearch
        ? folders.filter((f) => f.name.toLowerCase().includes(folderSearch.toLowerCase()))
        : folders,
    [folders, folderSearch]
  );

  const handleActivate = () => {
    if (isSelectionMode) {
      onToggleSelected?.(note.id);
      return;
    }
    onClick();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        handleActivate();
      }}
      {...(isSelectionMode ? {} : dragHandlers)}
      className={cn(
        "ow-list-row group relative w-full min-h-9 cursor-pointer px-2.5 py-2",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30",
        isSelected ? "ow-list-row-active" : isActive ? "ow-list-row-active" : "ow-list-row-idle",
        isDragging && "opacity-40 scale-[0.97]"
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {isSelectionMode && (
          <span
            className={cn(
              "mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
              isSelected
                ? "border-foreground/70 bg-foreground text-background"
                : "border-border bg-background text-transparent"
            )}
            aria-hidden="true"
          >
            <Check size={11} />
          </span>
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p
              className={cn(
                "min-w-0 flex-1 overflow-hidden truncate text-xs transition-colors duration-150",
                isActive ? "font-semibold text-foreground" : "font-medium text-current"
              )}
            >
              {note.title || t("notes.list.untitled")}
            </p>
            <div className="flex items-center gap-0.5 shrink-0">
              <span className="text-[11px] text-muted-foreground tabular-nums group-hover:opacity-0 transition-opacity">
                {relativeTime(timestamp ?? note.updated_at, t)}
              </span>
              {!isSelectionMode && (
                <DropdownMenu
                  onOpenChange={(open) => {
                    if (!open) {
                      setFolderSearch("");
                      setIsCreating(false);
                      setNewFolderName("");
                    }
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 w-6 rounded-md opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity absolute right-2 text-muted-foreground hover:text-foreground hover:bg-background active:bg-muted"
                    >
                      <MoreHorizontal size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4} className="min-w-40">
                    {noteFilesEnabled && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            window.electronAPI?.showNoteFile?.(note.id);
                          }}
                          className="text-xs gap-2 rounded-md px-2.5 py-1.5 cursor-pointer focus:bg-muted"
                        >
                          <ExternalLink
                            size={12}
                            className="text-muted-foreground/80 dark:text-muted-foreground/60"
                          />
                          {t("notes.context.showInFileManager", { manager: fileManagerName })}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs gap-2 rounded-md px-2.5 py-1.5 cursor-pointer focus:bg-muted data-[state=open]:bg-muted">
                        <FolderOpen
                          size={12}
                          className="text-muted-foreground/80 dark:text-muted-foreground/60"
                        />
                        {t("notes.context.moveToFolder")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        sideOffset={4}
                        className="min-w-36 rounded-md border border-border p-1"
                      >
                        {folders.length > 5 && (
                          <>
                            <div className="relative px-1.5 py-0.5">
                              <Search
                                size={9}
                                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/15 pointer-events-none"
                              />
                              <input
                                value={folderSearch}
                                onChange={(e) => setFolderSearch(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                placeholder={t("notes.context.searchFolders")}
                                className="input-inline w-full pl-4.5 pr-1 py-0.5 text-xs text-foreground placeholder:text-foreground/15 outline-none border-none appearance-none"
                              />
                            </div>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <div className="overflow-y-auto max-h-40">
                          {filteredFolders.map((folder) => {
                            const isCurrent = folder.id === currentFolderId;
                            return (
                              <DropdownMenuItem
                                key={folder.id}
                                disabled={isCurrent}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMoveToFolder(note.id, folder.id);
                                }}
                                className="text-xs gap-2 rounded-md px-2 py-1"
                              >
                                <span className="truncate flex-1">{folder.name}</span>
                                {isCurrent && (
                                  <Check size={9} className="text-muted-foreground shrink-0" />
                                )}
                              </DropdownMenuItem>
                            );
                          })}
                          {folderSearch && filteredFolders.length === 0 && (
                            <p className="text-xs text-foreground/20 text-center py-1.5">
                              {t("notes.context.noResults")}
                            </p>
                          )}
                        </div>
                        <DropdownMenuSeparator />
                        {isCreating ? (
                          <div className="px-1">
                            <input
                              autoFocus
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter" && newFolderName.trim()) {
                                  onCreateFolderAndMove(note.id, newFolderName.trim());
                                  setNewFolderName("");
                                  setIsCreating(false);
                                }
                                if (e.key === "Escape") {
                                  setIsCreating(false);
                                  setNewFolderName("");
                                }
                              }}
                              placeholder={t("notes.folders.folderName")}
                              className="input-inline w-full px-2 py-1.5 rounded-md bg-transparent text-xs text-foreground placeholder:text-foreground/20 outline-none border-none appearance-none"
                            />
                          </div>
                        ) : (
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              setIsCreating(true);
                            }}
                            className="text-xs gap-2 rounded-md px-2 py-1 text-foreground/40"
                          >
                            <Plus size={10} />
                            {t("notes.context.newFolder")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(note.id);
                      }}
                      className="text-xs gap-2 rounded-lg px-2.5 py-1.5 text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      <Trash2 size={12} />
                      {t("notes.context.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {isProcessingAction ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden truncate text-xs text-primary">
              <Loader2 size={10} className="shrink-0 animate-spin" />
              <span className="truncate">
                {actionState.actionName || t("notes.editor.processing")}
              </span>
            </p>
          ) : preview ? (
            <p className="mt-0.5 min-w-0 overflow-hidden truncate text-xs text-muted-foreground">
              {preview}
            </p>
          ) : null}
          {(note.tags || []).length > 0 && (
            <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
              {(note.tags || []).slice(0, 3).map((tag) => (
                <span
                  key={tag.toLocaleLowerCase()}
                  className="max-w-20 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {(note.tags || []).length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{(note.tags || []).length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
