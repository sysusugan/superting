import { ToolRegistry } from "./ToolRegistry";
import { createSearchNotesTool } from "./searchNotesTool";
import { getNoteTool } from "./getNoteTool";
import { createNoteTool } from "./createNoteTool";
import { updateNoteTool } from "./updateNoteTool";
import { listFoldersTool } from "./listFoldersTool";
import { clipboardTool } from "./clipboardTool";
import { webSearchTool } from "./webSearchTool";
import { calendarTool } from "./calendarTool";
import { createRunNoteActionTool, writeNoteContentTool } from "./noteActionChatTools";
import type { ActionItem, NoteItem } from "../../types/electron";

export { ToolRegistry } from "./ToolRegistry";
export type { ToolDefinition, ToolResult } from "./ToolRegistry";

interface ToolRegistrySettings {
  isSignedIn: boolean;
  gcalConnected: boolean;
  cloudBackupEnabled: boolean;
}

interface ToolRegistryContext {
  currentNote?: Pick<
    NoteItem,
    "id" | "title" | "content" | "enhanced_content" | "transcript" | "folder_id"
  >;
  availableActions?: ActionItem[];
}

export function createToolRegistry(
  settings: ToolRegistrySettings,
  context: ToolRegistryContext = {}
): ToolRegistry {
  const registry = new ToolRegistry();

  const useCloudSearch = settings.isSignedIn && settings.cloudBackupEnabled;
  registry.register(createSearchNotesTool({ useCloudSearch }));
  registry.register(getNoteTool);
  registry.register(createNoteTool);
  registry.register(updateNoteTool);
  registry.register(listFoldersTool);
  registry.register(clipboardTool);

  if (settings.isSignedIn) {
    registry.register(webSearchTool);
  }

  if (settings.gcalConnected) {
    registry.register(calendarTool);
  }

  if (context.currentNote) {
    registry.register(writeNoteContentTool);
    registry.register(
      createRunNoteActionTool({
        currentNote: context.currentNote,
        availableActions: context.availableActions ?? [],
      })
    );
  }

  return registry;
}
