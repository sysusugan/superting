import type { ActionItem, NoteItem } from "../../types/electron";
import type { ToolDefinition, ToolResult } from "./ToolRegistry";

type CurrentNote = Pick<
  NoteItem,
  "id" | "title" | "content" | "enhanced_content" | "transcript" | "folder_id"
>;

export interface NoteActionToolContext {
  currentNote: CurrentNote;
  availableActions: ActionItem[];
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function findAction(args: Record<string, unknown>, actions: ActionItem[]): ActionItem | null {
  const actionId = Number(args.actionId);
  if (Number.isFinite(actionId)) {
    const byId = actions.find((action) => action.id === actionId);
    if (byId) return byId;
  }

  const name = normalize(args.actionName ?? args.name);
  if (!name) return null;
  return actions.find((action) => normalize(action.name) === name) ?? null;
}

export function createRunNoteActionTool({
  currentNote,
  availableActions,
}: NoteActionToolContext): ToolDefinition {
  return {
    name: "run_note_action",
    description:
      "Request confirmation to run one of the user's custom note actions on the current note only. Use this when the user asks to apply, run, summarize, format, or transform the current note with a named custom action. This tool only creates a pending confirmation; it does not modify the note until the user confirms.",
    parameters: {
      type: "object",
      properties: {
        actionId: {
          type: "number",
          description: "The custom action ID, if known.",
        },
        actionName: {
          type: "string",
          description: "The custom action name, if the ID is not known.",
        },
      },
      additionalProperties: false,
    },
    readOnly: false,
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const action = findAction(args, availableActions);
      if (!action) {
        const names = availableActions.map((item) => item.name).join(", ");
        return {
          success: false,
          data: null,
          displayText: names
            ? `Custom action not found. Available actions: ${names}`
            : "No custom actions are available",
        };
      }

      return {
        success: true,
        data: {
          confirmationRequired: true,
          confirmationStatus: "pending",
          confirmationType: "run_note_action",
          payload: {
            actionId: action.id,
            noteId: currentNote.id,
          },
        },
        displayText: `Confirm action: "${action.name}"`,
      };
    },
  };
}

export const writeNoteContentTool: ToolDefinition = {
  name: "write_note_content",
  description:
    "Request confirmation to write provided content to the current note or enhanced content. Use this when the user asks to save, append, overwrite, or write your answer into the current note. This tool only creates a pending confirmation; it does not modify the note until the user confirms.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The exact content to write.",
      },
      target: {
        type: "string",
        enum: ["content", "enhanced_content"],
        description: "Where to write: content for notes, enhanced_content for enhanced content.",
      },
      writeMode: {
        type: "string",
        enum: ["overwrite", "append"],
        description: "Whether to overwrite the target or append to it.",
      },
    },
    required: ["content", "target", "writeMode"],
    additionalProperties: false,
  },
  readOnly: false,
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const content = typeof args.content === "string" ? args.content.trim() : "";
    const target = args.target === "content" ? "content" : "enhanced_content";
    const writeMode = args.writeMode === "overwrite" ? "overwrite" : "append";

    if (!content) {
      return {
        success: false,
        data: null,
        displayText: "Content is required before writing to the note",
      };
    }

    return {
      success: true,
      data: {
        confirmationRequired: true,
        confirmationStatus: "pending",
        confirmationType: "write_note_content",
        payload: {
          content,
          target,
          writeMode,
        },
      },
      displayText: `Confirm writing AI response to ${
        target === "content" ? "notes" : "enhanced content"
      }`,
    };
  },
};
