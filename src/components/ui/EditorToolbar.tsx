import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  FileCode,
  FileUp,
  ImagePlus,
  MoreHorizontal,
  Redo2,
  Undo2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Tooltip } from "./tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export type EditorToolbarMode = "rich" | "markdown";

export interface EditorToolbarAction {
  key: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}

interface EditorToolbarProps {
  mode: EditorToolbarMode;
  position?: "rich" | "markdown";
  currentMode?: EditorToolbarMode;
  onModeChange?: (mode: EditorToolbarMode) => void;
  disabled?: boolean;
  canInsertImage?: boolean;
  onImageFile?: (file: File) => void;
  onImportFile?: () => void;
  undoAction?: EditorToolbarAction;
  redoAction?: EditorToolbarAction;
  blockActions?: EditorToolbarAction[];
  inlineActions?: EditorToolbarAction[];
  listActions?: EditorToolbarAction[];
  insertActions?: EditorToolbarAction[];
  tableActions?: EditorToolbarAction[];
  className?: string;
}

function ToolbarButton({
  action,
  children,
}: {
  action: EditorToolbarAction;
  children?: ReactNode;
}) {
  return (
    <Tooltip content={action.label}>
      <button
        type="button"
        aria-label={action.label}
        title={action.label}
        disabled={action.disabled}
        aria-pressed={action.active || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={action.onClick}
        className={cn(
          "editor-toolbar-button",
          action.active && "editor-toolbar-button-active",
          action.danger && "editor-toolbar-button-danger"
        )}
      >
        {children ?? action.icon}
      </button>
    </Tooltip>
  );
}

function ToolbarGroup({ actions }: { actions?: EditorToolbarAction[] }) {
  const visibleActions = actions?.filter(Boolean) ?? [];
  if (visibleActions.length === 0) return null;
  return (
    <div className="editor-toolbar-group">
      {visibleActions.map((action) => (
        <ToolbarButton key={action.key} action={action} />
      ))}
    </div>
  );
}

function MoreActionsMenu({ actions, label }: { actions: EditorToolbarAction[]; label: string }) {
  const visibleActions = actions.filter(Boolean);
  if (visibleActions.length === 0) return null;

  return (
    <DropdownMenu>
      <Tooltip content={label}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            onMouseDown={(event) => event.preventDefault()}
            className="editor-toolbar-button"
          >
            <MoreHorizontal size={15} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-40 p-1">
        {visibleActions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            disabled={action.disabled}
            onClick={action.onClick}
            className="gap-2 text-xs"
          >
            <span className="text-foreground/45">{action.icon}</span>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditorToolbar({
  mode,
  position = mode,
  currentMode = mode,
  onModeChange,
  disabled,
  canInsertImage,
  onImageFile,
  onImportFile,
  undoAction,
  redoAction,
  blockActions,
  inlineActions,
  listActions,
  insertActions,
  tableActions,
  className,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const imageAction: EditorToolbarAction = {
    key: "image",
    label: t("notes.editor.insertImage"),
    icon: <ImagePlus size={15} />,
    disabled: disabled || !canInsertImage || !onImageFile,
    onClick: () => imageInputRef.current?.click(),
  };

  const importAction: EditorToolbarAction = {
    key: "import",
    label: t("notes.editor.importFile"),
    icon: <FileUp size={15} />,
    disabled: disabled || !onImportFile,
    onClick: () => onImportFile?.(),
  };
  const moreActions = [imageAction, importAction];

  const fallbackUndo: EditorToolbarAction = undoAction ?? {
    key: "undo",
    label: t("notes.editor.undo"),
    icon: <Undo2 size={15} />,
    disabled: true,
    onClick: () => undefined,
  };

  const fallbackRedo: EditorToolbarAction = redoAction ?? {
    key: "redo",
    label: t("notes.editor.redo"),
    icon: <Redo2 size={15} />,
    disabled: true,
    onClick: () => undefined,
  };

  return (
    <div className={cn("editor-toolbar", className)} data-toolbar-mode={mode} data-position={position}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,.svg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (file) onImageFile?.(file);
        }}
      />
      <div className="editor-toolbar-row editor-toolbar-row-primary">
        <div className="editor-toolbar-group">
          <ToolbarButton action={fallbackUndo} />
          <ToolbarButton action={fallbackRedo} />
        </div>
        <ToolbarGroup actions={[imageAction, importAction]} />
        {onModeChange && (
          <div className="editor-toolbar-mode-switch" role="group" aria-label={t("notes.editor.editorMode")}>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onModeChange("rich")}
              className={cn(
                "editor-toolbar-mode-button",
                currentMode === "rich" && "editor-toolbar-mode-button-active"
              )}
            >
              <AlignLeft size={13} />
              <span>{t("notes.editor.richText")}</span>
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onModeChange("markdown")}
              className={cn(
                "editor-toolbar-mode-button",
                currentMode === "markdown" && "editor-toolbar-mode-button-active"
              )}
            >
              <FileCode size={13} />
              <span>{t("notes.editor.markdownSource")}</span>
            </button>
          </div>
        )}
        <MoreActionsMenu actions={moreActions} label={t("notes.editor.moreActions")} />
      </div>
      {mode === "rich" && (
        <div className="editor-toolbar-row editor-toolbar-row-format">
          <ToolbarGroup actions={blockActions} />
          <ToolbarGroup actions={inlineActions} />
          <ToolbarGroup actions={listActions} />
          <ToolbarGroup actions={insertActions} />
          <ToolbarGroup actions={tableActions} />
        </div>
      )}
    </div>
  );
}

export default EditorToolbar;
