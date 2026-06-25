import { useEffect, useRef, useCallback, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Columns3,
  Combine,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PanelLeft,
  PanelTop,
  Quote,
  Redo2,
  Rows3,
  Split,
  SquareCode,
  Strikethrough,
  Table2,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "tiptap-markdown";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "../lib/utils";
import { EditorToolbar, type EditorToolbarAction, type EditorToolbarMode } from "./EditorToolbar";
import { makeCurrentPageFindPattern, type FindMatch } from "../../utils/currentPageFind";

interface FindHighlightState {
  decorations: DecorationSet;
  query: string;
  ignoreCase: boolean;
  activeIndex: number;
}

const findHighlightPluginKey = new PluginKey<FindHighlightState>("richTextFindHighlight");

function buildFindDecorations(
  doc: any,
  query: string,
  ignoreCase: boolean,
  activeIndex: number
): DecorationSet {
  const pattern = makeCurrentPageFindPattern(query, { ignoreCase });
  if (!pattern) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  let matchIndex = 0;

  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(pattern)) {
      const from = pos + (match.index ?? 0);
      const to = from + match[0].length;
      const isActive = matchIndex === activeIndex;
      decorations.push(
        Decoration.inline(from, to, {
          class: isActive ? "ow-find-match ow-find-match-active" : "ow-find-match",
          "data-find-match": "true",
          ...(isActive ? { "data-find-active": "true" } : {}),
        })
      );
      matchIndex += 1;
    }
  });

  return DecorationSet.create(doc, decorations);
}

function getDocFindRanges(
  doc: any,
  query: string,
  ignoreCase: boolean
): Array<FindMatch & { from: number; to: number }> {
  const pattern = makeCurrentPageFindPattern(query, { ignoreCase });
  if (!pattern) return [];

  const ranges: Array<FindMatch & { from: number; to: number }> = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(pattern)) {
      const from = pos + (match.index ?? 0);
      const to = from + match[0].length;
      ranges.push({
        index: match.index ?? 0,
        length: match[0].length,
        from,
        to,
      });
    }
  });
  return ranges;
}

const FindHighlight = Extension.create({
  name: "findHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<FindHighlightState>({
        key: findHighlightPluginKey,
        state: {
          init: (_, state) => ({
            decorations: DecorationSet.empty,
            query: "",
            ignoreCase: true,
            activeIndex: -1,
          }),
          apply: (tr, previous, _oldState, newState) => {
            const meta = tr.getMeta(findHighlightPluginKey) as
              | { query: string; ignoreCase: boolean; activeIndex: number }
              | undefined;
            const next = meta
              ? meta
              : {
                  query: previous.query,
                  ignoreCase: previous.ignoreCase,
                  activeIndex: previous.activeIndex,
                };

            if (!meta && !tr.docChanged) {
              return previous;
            }

            return {
              ...next,
              decorations: buildFindDecorations(
                newState.doc,
                next.query,
                next.ignoreCase,
                next.activeIndex
              ),
            };
          },
        },
        props: {
          decorations(state) {
            return findHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

const Underline = Mark.create({
  name: "underline",

  parseHTML() {
    return [
      { tag: "u" },
      {
        style: "text-decoration",
        getAttrs: (value) =>
          typeof value === "string" && value.includes("underline") ? {} : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }: any) =>
          commands.toggleMark(this.name),
    } as any;
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "<u>",
          close: "</u>",
          mixable: true,
        },
        parse: {},
      },
    };
  },
});

interface RichTextEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  toolbarMode?: EditorToolbarMode;
  onEditorModeChange?: (mode: EditorToolbarMode) => void;
  onImportFile?: () => void;
  editorRef?: MutableRefObject<Editor | null>;
  findQuery?: string;
  findActiveIndex?: number;
  findIgnoreCase?: boolean;
  onFindMatchCountChange?: (count: number) => void;
  replaceRequest?: {
    id: number;
    mode: "current" | "all";
    query: string;
    replacement: string;
    activeIndex: number;
    ignoreCase: boolean;
  } | null;
  onReplaceRequestComplete?: (result: { id: number; replaced: number }) => void;
  onImageUpload?: (file: File) => Promise<{ src: string; alt?: string }>;
}

function getFirstImageFile(fileList?: FileList | null): File | null {
  if (!fileList) return null;
  return (
    Array.from(fileList).find(
      (file) => file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg")
    ) ?? null
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  toolbarMode = "rich",
  onEditorModeChange,
  onImportFile,
  editorRef,
  findQuery = "",
  findActiveIndex = -1,
  findIgnoreCase = true,
  onFindMatchCountChange,
  replaceRequest,
  onReplaceRequestComplete,
  onImageUpload,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const internalValueRef = useRef(value);
  const suppressUpdateRef = useRef(false);
  const lastReplaceRequestIdRef = useRef<number | null>(null);
  const imageUploadRef = useRef(onImageUpload);
  const [isTableActive, setIsTableActive] = useState(false);

  useEffect(() => {
    imageUploadRef.current = onImageUpload;
  }, [onImageUpload]);

  const insertImageFile = useCallback(async (view: any, file: File) => {
    const upload = imageUploadRef.current;
    if (!upload) return;
    const result = await upload(file);
    if (!result?.src || view.isDestroyed) return;
    const imageNode = view.state.schema.nodes.image?.create({
      src: result.src,
      alt: result.alt || file.name || "",
    });
    if (!imageNode) return;
    view.dispatch(view.state.tr.replaceSelectionWith(imageNode).scrollIntoView());
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: placeholder || "",
        emptyEditorClass: "is-editor-empty",
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      TableKit.configure({
        table: {
          resizable: false,
          allowTableNodeSelection: true,
        },
      }),
      FindHighlight,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      if (suppressUpdateRef.current) return;

      const md = (ed.storage as any).markdown.getMarkdown() as string;
      internalValueRef.current = md;
      onChange?.(md);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      setIsTableActive(ed.isActive("table"));
    },
    onTransaction: ({ editor: ed }) => {
      setIsTableActive(ed.isActive("table"));
    },
    editorProps: {
      attributes: {
        class: "rich-text-editor-content",
      },
      handlePaste(view, event) {
        if (disabled || !imageUploadRef.current) return false;
        const imageFile = getFirstImageFile(event.clipboardData?.files);
        if (!imageFile) return false;
        event.preventDefault();
        void insertImageFile(view, imageFile);
        return true;
      },
      handleDrop(view, event) {
        if (disabled || !imageUploadRef.current) return false;
        const imageFile = getFirstImageFile(event.dataTransfer?.files);
        if (!imageFile) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (pos) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos)))
          );
        }
        event.preventDefault();
        void insertImageFile(view, imageFile);
        return true;
      },
    },
  });

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
    return () => {
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef]);

  // Sync external value changes (e.g. dictation, programmatic updates)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === internalValueRef.current) return;

    internalValueRef.current = value;
    suppressUpdateRef.current = true;

    const { from, to } = editor.state.selection;
    editor.commands.setContent(value);

    // Restore cursor position within bounds
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.min(from, docSize);
    const safeTo = Math.min(to, docSize);
    editor.commands.setTextSelection({ from: safeFrom, to: safeTo });

    suppressUpdateRef.current = false;
  }, [value, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || disabled || !replaceRequest) return;
    if (lastReplaceRequestIdRef.current === replaceRequest.id) return;
    lastReplaceRequestIdRef.current = replaceRequest.id;

    const ranges = getDocFindRanges(
      editor.state.doc,
      replaceRequest.query,
      replaceRequest.ignoreCase
    );
    const targets =
      replaceRequest.mode === "all"
        ? ranges
        : ranges[replaceRequest.activeIndex]
          ? [ranges[replaceRequest.activeIndex]]
          : [];

    if (targets.length === 0) {
      onReplaceRequestComplete?.({ id: replaceRequest.id, replaced: 0 });
      return;
    }

    let tr = editor.state.tr;
    for (const target of [...targets].reverse()) {
      tr = tr.insertText(replaceRequest.replacement, target.from, target.to);
    }
    editor.view.dispatch(tr);
    onReplaceRequestComplete?.({ id: replaceRequest.id, replaced: targets.length });
  }, [disabled, editor, onReplaceRequestComplete, replaceRequest]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    onFindMatchCountChange?.(getDocFindRanges(editor.state.doc, findQuery, findIgnoreCase).length);
    editor.view.dispatch(
      editor.state.tr.setMeta(findHighlightPluginKey, {
        query: findQuery,
        ignoreCase: findIgnoreCase,
        activeIndex: findActiveIndex,
      })
    );
  }, [editor, findActiveIndex, findIgnoreCase, findQuery, onFindMatchCountChange, value]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || findActiveIndex < 0) return;
    const frameId = window.requestAnimationFrame(() => {
      const active = editor.view.dom.querySelector<HTMLElement>("[data-find-active='true']");
      active?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [editor, findActiveIndex]);

  // Sync editable state
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  const handleClick = useCallback(() => {
    if (editor && !editor.isFocused && !disabled) {
      editor.commands.focus();
    }
  }, [editor, disabled]);

  const insertImageAtSelection = useCallback(
    async (file: File) => {
      if (!editor || editor.isDestroyed || disabled) return;
      editor.commands.focus();
      await insertImageFile(editor.view, file);
    },
    [disabled, editor, insertImageFile]
  );

  const runEditorCommand = useCallback(
    (command: string, ...args: any[]) => {
      const chain = editor?.chain().focus() as any;
      chain?.[command]?.(...args).run();
    },
    [editor]
  );

  const tableCan = editor?.can() as any;
  const tableCommands = editor?.chain().focus() as any;
  const canEditTable = !!editor && !editor.isDestroyed && !disabled;
  const canInsertTable =
    canEditTable && !!tableCan?.insertTable?.({ rows: 3, cols: 3, withHeaderRow: true });
  const canAddRowBefore = canEditTable && isTableActive && !!tableCan?.addRowBefore?.();
  const canAddRowAfter = canEditTable && isTableActive && !!tableCan?.addRowAfter?.();
  const canDeleteRow = canEditTable && isTableActive && !!tableCan?.deleteRow?.();
  const canAddColumnBefore = canEditTable && isTableActive && !!tableCan?.addColumnBefore?.();
  const canAddColumnAfter = canEditTable && isTableActive && !!tableCan?.addColumnAfter?.();
  const canDeleteColumn = canEditTable && isTableActive && !!tableCan?.deleteColumn?.();
  const canDeleteTable = canEditTable && isTableActive && !!tableCan?.deleteTable?.();
  const canToggleHeaderRow = canEditTable && isTableActive && !!tableCan?.toggleHeaderRow?.();
  const canToggleHeaderColumn = canEditTable && isTableActive && !!tableCan?.toggleHeaderColumn?.();
  const canMergeOrSplit = canEditTable && isTableActive && !!tableCan?.mergeOrSplit?.();
  const showToolbar = !!onChange || !!onEditorModeChange || !!onImportFile || !!onImageUpload;
  const canEditRichText = !!editor && !editor.isDestroyed && !disabled;
  const canUndo = canEditRichText && !!(editor.can() as any).undo?.();
  const canRedo = canEditRichText && !!(editor.can() as any).redo?.();

  const blockActions: EditorToolbarAction[] = [
    {
      key: "paragraph",
      label: t("notes.editor.paragraph"),
      icon: <Type size={15} />,
      active: !!editor?.isActive("paragraph"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("setParagraph"),
    },
    {
      key: "heading1",
      label: t("notes.editor.heading1"),
      icon: <Heading1 size={15} />,
      active: !!editor?.isActive("heading", { level: 1 }),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleHeading", { level: 1 }),
    },
    {
      key: "heading2",
      label: t("notes.editor.heading2"),
      icon: <Heading2 size={15} />,
      active: !!editor?.isActive("heading", { level: 2 }),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleHeading", { level: 2 }),
    },
    {
      key: "heading3",
      label: t("notes.editor.heading3"),
      icon: <Heading3 size={15} />,
      active: !!editor?.isActive("heading", { level: 3 }),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleHeading", { level: 3 }),
    },
  ];

  const inlineActions: EditorToolbarAction[] = [
    {
      key: "bold",
      label: t("notes.editor.bold"),
      icon: <Bold size={15} />,
      active: !!editor?.isActive("bold"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleBold"),
    },
    {
      key: "italic",
      label: t("notes.editor.italic"),
      icon: <Italic size={15} />,
      active: !!editor?.isActive("italic"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleItalic"),
    },
    {
      key: "underline",
      label: t("notes.editor.underline"),
      icon: <UnderlineIcon size={15} />,
      active: !!editor?.isActive("underline"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleUnderline"),
    },
    {
      key: "strike",
      label: t("notes.editor.strike"),
      icon: <Strikethrough size={15} />,
      active: !!editor?.isActive("strike"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleStrike"),
    },
    {
      key: "code",
      label: t("notes.editor.inlineCode"),
      icon: <Code2 size={15} />,
      active: !!editor?.isActive("code"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleCode"),
    },
  ];

  const listActions: EditorToolbarAction[] = [
    {
      key: "bulletList",
      label: t("notes.editor.bulletList"),
      icon: <List size={15} />,
      active: !!editor?.isActive("bulletList"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleBulletList"),
    },
    {
      key: "orderedList",
      label: t("notes.editor.orderedList"),
      icon: <ListOrdered size={15} />,
      active: !!editor?.isActive("orderedList"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleOrderedList"),
    },
    {
      key: "taskList",
      label: t("notes.editor.taskList"),
      icon: <ListChecks size={15} />,
      active: !!editor?.isActive("taskList"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleTaskList"),
    },
    {
      key: "blockquote",
      label: t("notes.editor.blockquote"),
      icon: <Quote size={15} />,
      active: !!editor?.isActive("blockquote"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleBlockquote"),
    },
    {
      key: "codeBlock",
      label: t("notes.editor.codeBlock"),
      icon: <SquareCode size={15} />,
      active: !!editor?.isActive("codeBlock"),
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("toggleCodeBlock"),
    },
  ];

  const insertActions: EditorToolbarAction[] = [
    {
      key: "horizontalRule",
      label: t("notes.editor.horizontalRule"),
      icon: <Minus size={15} />,
      disabled: !canEditRichText,
      onClick: () => runEditorCommand("setHorizontalRule"),
    },
    {
      key: "insertTable",
      label: t("notes.editor.insertTable"),
      icon: <Table2 size={15} />,
      disabled: !canInsertTable,
      onClick: () =>
        tableCommands?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
  ];

  const tableActions: EditorToolbarAction[] = isTableActive
    ? [
        {
          key: "addRowAbove",
          label: t("notes.editor.addRowAbove"),
          icon: <ArrowUpToLine size={15} />,
          disabled: !canAddRowBefore,
          onClick: () => tableCommands?.addRowBefore().run(),
        },
        {
          key: "addRowBelow",
          label: t("notes.editor.addRowBelow"),
          icon: <ArrowDownToLine size={15} />,
          disabled: !canAddRowAfter,
          onClick: () => tableCommands?.addRowAfter().run(),
        },
        {
          key: "deleteRow",
          label: t("notes.editor.deleteRow"),
          icon: <Rows3 size={15} />,
          disabled: !canDeleteRow,
          onClick: () => tableCommands?.deleteRow().run(),
        },
        {
          key: "addColumnLeft",
          label: t("notes.editor.addColumnLeft"),
          icon: <ArrowLeftToLine size={15} />,
          disabled: !canAddColumnBefore,
          onClick: () => tableCommands?.addColumnBefore().run(),
        },
        {
          key: "addColumnRight",
          label: t("notes.editor.addColumnRight"),
          icon: <ArrowRightToLine size={15} />,
          disabled: !canAddColumnAfter,
          onClick: () => tableCommands?.addColumnAfter().run(),
        },
        {
          key: "deleteColumn",
          label: t("notes.editor.deleteColumn"),
          icon: <Columns3 size={15} />,
          disabled: !canDeleteColumn,
          onClick: () => tableCommands?.deleteColumn().run(),
        },
        {
          key: "toggleHeaderRow",
          label: t("notes.editor.toggleHeaderRow"),
          icon: <PanelTop size={15} />,
          disabled: !canToggleHeaderRow,
          onClick: () => tableCommands?.toggleHeaderRow().run(),
        },
        {
          key: "toggleHeaderColumn",
          label: t("notes.editor.toggleHeaderColumn"),
          icon: <PanelLeft size={15} />,
          disabled: !canToggleHeaderColumn,
          onClick: () => tableCommands?.toggleHeaderColumn().run(),
        },
        {
          key: "mergeOrSplitCells",
          label: t("notes.editor.mergeOrSplitCells"),
          icon: tableCan?.splitCell?.() ? <Split size={15} /> : <Combine size={15} />,
          disabled: !canMergeOrSplit,
          onClick: () => tableCommands?.mergeOrSplit().run(),
        },
        {
          key: "deleteTable",
          label: t("notes.editor.deleteTable"),
          icon: <Trash2 size={15} />,
          danger: true,
          disabled: !canDeleteTable,
          onClick: () => tableCommands?.deleteTable().run(),
        },
      ]
    : [];

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", className)} onClick={handleClick}>
      {showToolbar && (
        <EditorToolbar
          mode="rich"
          currentMode={toolbarMode}
          onModeChange={onEditorModeChange}
          disabled={disabled}
          canInsertImage={!!onImageUpload}
          onImageFile={insertImageAtSelection}
          onImportFile={onImportFile}
          undoAction={{
            key: "undo",
            label: t("notes.editor.undo"),
            icon: <Undo2 size={15} />,
            disabled: !canUndo,
            onClick: () => runEditorCommand("undo"),
          }}
          redoAction={{
            key: "redo",
            label: t("notes.editor.redo"),
            icon: <Redo2 size={15} />,
            disabled: !canRedo,
            onClick: () => runEditorCommand("redo"),
          }}
          blockActions={blockActions}
          inlineActions={inlineActions}
          listActions={listActions}
          insertActions={insertActions}
          tableActions={tableActions}
        />
      )}
      <EditorContent
        editor={editor}
        className={cn("min-h-0 flex-1 overflow-y-auto", disabled && "pointer-events-none opacity-70")}
      />
    </div>
  );
}
