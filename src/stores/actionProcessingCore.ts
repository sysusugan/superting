const DEFAULT_NOTE_TITLES = new Set([
  "",
  "Untitled",
  "Untitled Note",
  "New note",
  "无标题",
  "无标题笔记",
  "未命名",
  "未命名筆記",
]);

export function shouldAutoGenerateActionTitle(title: string | null | undefined): boolean {
  return DEFAULT_NOTE_TITLES.has((title ?? "").trim());
}

export type ActionOutputTarget = "content" | "enhanced_content";
export type ActionWriteMode = "overwrite" | "append";

interface ActionOutputInput {
  outputTarget?: string | null;
  writeMode?: string | null;
  generatedContent: string;
  existingContent?: string | null;
  existingEnhancedContent?: string | null;
  actionPrompt: string;
  contentHash: string;
}

interface WriteNoteContentInput {
  target?: string | null;
  writeMode?: string | null;
  content: string;
  existingContent?: string | null;
  existingEnhancedContent?: string | null;
}

function normalizeOutputTarget(target: string | null | undefined): ActionOutputTarget {
  return target === "content" ? "content" : "enhanced_content";
}

function normalizeWriteMode(mode: string | null | undefined): ActionWriteMode {
  return mode === "append" ? "append" : "overwrite";
}

function applyWriteMode(
  existing: string | null | undefined,
  generated: string,
  mode: ActionWriteMode
) {
  const next = generated.trim();
  if (mode === "overwrite") return next;

  const current = (existing ?? "").trimEnd();
  return current ? `${current}\n\n${next}` : next;
}

export function buildActionOutputUpdates({
  outputTarget,
  writeMode,
  generatedContent,
  existingContent,
  existingEnhancedContent,
  actionPrompt,
  contentHash,
}: ActionOutputInput): Record<string, string | null> {
  const target = normalizeOutputTarget(outputTarget);
  const mode = normalizeWriteMode(writeMode);

  if (target === "content") {
    return {
      content: applyWriteMode(existingContent, generatedContent, mode),
    };
  }

  return {
    enhanced_content: applyWriteMode(existingEnhancedContent, generatedContent, mode),
    enhancement_prompt: actionPrompt,
    enhanced_at_content_hash: contentHash,
  };
}

export function buildWriteNoteContentUpdates({
  target,
  writeMode,
  content,
  existingContent,
  existingEnhancedContent,
}: WriteNoteContentInput): Record<string, string> {
  const outputTarget = normalizeOutputTarget(target);
  const mode = normalizeWriteMode(writeMode);
  const nextContent = applyWriteMode(
    outputTarget === "content" ? existingContent : existingEnhancedContent,
    content,
    mode
  );

  return outputTarget === "content" ? { content: nextContent } : { enhanced_content: nextContent };
}
