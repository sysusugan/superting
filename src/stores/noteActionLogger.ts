const NOTE_ACTION_LOG_SCOPE = "note-actions";

type NoteActionLogLevel = "info" | "warn" | "error";

function textMeta(value: string | null | undefined) {
  const text = String(value ?? "");
  return {
    length: text.length,
    text,
  };
}

export function makeNoteActionOperationId(noteId: number, actionId: number): string {
  return `note-${noteId}-action-${actionId}-${Date.now()}`;
}

export function logNoteAction(
  message: string,
  meta: Record<string, unknown>,
  level: NoteActionLogLevel = "info"
): void {
  const entry = {
    level,
    message,
    meta,
    scope: NOTE_ACTION_LOG_SCOPE,
    source: "renderer",
  };

  if (typeof window !== "undefined" && window.electronAPI?.log) {
    void window.electronAPI.log(entry).catch(() => {
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
        `[${NOTE_ACTION_LOG_SCOPE}] ${message}`,
        meta
      );
    });
    return;
  }

  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    `[${NOTE_ACTION_LOG_SCOPE}] ${message}`,
    meta
  );
}

export function loggableText(value: string | null | undefined): ReturnType<typeof textMeta> {
  return textMeta(value);
}
