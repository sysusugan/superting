import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Extension } from "@tiptap/core";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "../lib/utils";
import { countFindMatches, makeCurrentPageFindPattern } from "../../utils/currentPageFind";

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

interface RichTextEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  editorRef?: MutableRefObject<Editor | null>;
  findQuery?: string;
  findActiveIndex?: number;
  findIgnoreCase?: boolean;
  onFindMatchCountChange?: (count: number) => void;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  editorRef,
  findQuery = "",
  findActiveIndex = -1,
  findIgnoreCase = true,
  onFindMatchCountChange,
}: RichTextEditorProps) {
  const internalValueRef = useRef(value);
  const suppressUpdateRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: placeholder || "",
        emptyEditorClass: "is-editor-empty",
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
    editorProps: {
      attributes: {
        class: "rich-text-editor-content",
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
    if (!editor || editor.isDestroyed) return;
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n");
    onFindMatchCountChange?.(countFindMatches(text, findQuery, { ignoreCase: findIgnoreCase }));
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

  return (
    <div className={cn("relative w-full h-full", className)} onClick={handleClick}>
      <EditorContent
        editor={editor}
        className={cn("h-full overflow-y-auto", disabled && "pointer-events-none opacity-70")}
      />
    </div>
  );
}
