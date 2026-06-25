import { useCallback, useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import {
  applyMarkdownReplaceRequest,
  insertMarkdownImageReference,
} from "../../utils/markdownSourceEditor";
import { countFindMatches, getFindMatches } from "../../utils/currentPageFind";

interface MarkdownSourceEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
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

export function MarkdownSourceEditor({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  findQuery = "",
  findActiveIndex = -1,
  findIgnoreCase = true,
  onFindMatchCountChange,
  replaceRequest,
  onReplaceRequestComplete,
  onImageUpload,
}: MarkdownSourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastReplaceRequestIdRef = useRef<number | null>(null);

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!onImageUpload || disabled) return;
      const result = await onImageUpload(file);
      if (!result?.src) return;

      const textarea = textareaRef.current;
      const inserted = insertMarkdownImageReference({
        value,
        selectionStart: textarea?.selectionStart ?? -1,
        selectionEnd: textarea?.selectionEnd ?? -1,
        src: result.src,
        alt: result.alt || file.name || "",
      });
      onChange?.(inserted.value);
      window.requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(inserted.selection.start, inserted.selection.end);
      });
    },
    [disabled, onChange, onImageUpload, value]
  );

  useEffect(() => {
    onFindMatchCountChange?.(countFindMatches(value, findQuery, { ignoreCase: findIgnoreCase }));
  }, [findIgnoreCase, findQuery, onFindMatchCountChange, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || findActiveIndex < 0 || !findQuery) return;
    const match = getFindMatches(value, findQuery, { ignoreCase: findIgnoreCase })[findActiveIndex];
    if (!match) return;
    textarea.focus();
    textarea.setSelectionRange(match.index, match.index + match.length);
  }, [findActiveIndex, findIgnoreCase, findQuery, value]);

  useEffect(() => {
    if (disabled || !replaceRequest) return;
    if (lastReplaceRequestIdRef.current === replaceRequest.id) return;
    lastReplaceRequestIdRef.current = replaceRequest.id;

    const result = applyMarkdownReplaceRequest(value, replaceRequest);
    if (result.replaced > 0) onChange?.(result.value);
    onReplaceRequestComplete?.({ id: replaceRequest.id, replaced: result.replaced });
  }, [disabled, onChange, onReplaceRequestComplete, replaceRequest, value]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFile = getFirstImageFile(event.clipboardData.files);
      if (!imageFile || !onImageUpload) return;
      event.preventDefault();
      void insertImageFile(imageFile);
    },
    [insertImageFile, onImageUpload]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      const imageFile = getFirstImageFile(event.dataTransfer.files);
      if (!imageFile || !onImageUpload) return;
      event.preventDefault();
      void insertImageFile(imageFile);
    },
    [insertImageFile, onImageUpload]
  );

  return (
    <div className={cn("relative w-full h-full", className)}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onPaste={handlePaste}
        onDrop={handleDrop}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="markdown-source-editor h-full w-full resize-none border-0 bg-transparent px-5 py-4 pb-24 font-mono text-[13px] leading-6 text-foreground outline-none"
      />
    </div>
  );
}

export default MarkdownSourceEditor;
