import { t } from "i18next";
import type { ToolDefinition } from "./ToolRegistry";

type Row = Record<string, unknown>;

export function createTrackingChatTools(noteId: number): ToolDefinition[] {
  let lastRead: { items: Row[]; updates: Row[] } | null = null;
  return [
    {
      name: "get_current_note_tracking",
      description:
        "Read saved tracking items and progress for the current note, separately from the latest pending extraction. Always use this for questions about extracted items; never infer saved records from note text. Read before editing. Ask the user if identity is ambiguous.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      readOnly: true,
      async execute() {
        const data = await window.electronAPI.getNoteTracking(noteId);
        lastRead = { items: (data.items || []) as Row[], updates: (data.updates || []) as Row[] };
        const latest = (data.extractions as Row[] | undefined)?.[0];
        return {
          success: true,
          data: {
            ...lastRead,
            status: latest?.status || "notExtracted",
            pending:
              latest?.status === "pending"
                ? { id: latest.id, result: latest.reviewResult || latest.result }
                : null,
          },
          displayText: t(latest ? "trackingChat.read" : "notes.trackingStatus.notExtracted"),
        };
      },
    },
    {
      name: "get_tracking_templates",
      description:
        "Read the user's actual tracking templates: IDs, names, versions, fields, states and update types. Read only; do not invent templates.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      readOnly: true,
      async execute() {
        return {
          success: true,
          data: await window.electronAPI.getTrackingTemplates(),
          displayText: t("trackingChat.templates"),
        };
      },
    },
    {
      name: "update_current_note_tracking",
      description:
        "Propose edits to a saved item linked to this note or this note's progress. First call get_current_note_tracking and resolve IDs unambiguously. Only proposes a confirmation, never writes immediately. Item edits affect every note using that ID. Cannot edit evidence, type, relationships or delete records.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["itemId"],
        properties: {
          itemId: { type: "integer" },
          updateId: { type: "integer" },
          itemPatch: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              state: { type: "string" },
              properties: { type: "object", additionalProperties: true },
            },
          },
          updatePatch: {
            type: "object",
            additionalProperties: false,
            properties: {
              content: { type: "string" },
              update_type: { type: "string" },
              occurred_at: { type: ["string", "null"], description: "ISO date or null" },
              state_after: { type: ["string", "null"] },
            },
          },
        },
      },
      readOnly: false,
      async execute(args) {
        const item = lastRead?.items.find((row) => row.id === args.itemId);
        const update =
          args.updateId == null
            ? null
            : lastRead?.updates.find(
                (row) => row.id === args.updateId && row.item_id === args.itemId
              );
        if (!item || (args.updateId != null && !update))
          throw new Error(t("trackingChat.readFirst"));
        const itemPatch = (args.itemPatch || {}) as Row;
        const updatePatch = (args.updatePatch || {}) as Row;
        if (!Object.keys(itemPatch).length && !Object.keys(updatePatch).length)
          throw new Error(t("trackingChat.noChanges"));
        const changes = [
          [item, itemPatch],
          [update || {}, updatePatch],
        ].flatMap(([before, patch]) =>
          Object.entries(patch).map(([field, value]) => ({
            field,
            before: before[field],
            after:
              field === "properties" ? { ...(before[field] as Row), ...(value as Row) } : value,
          }))
        );
        return {
          success: true,
          displayText: t("trackingChat.confirm"),
          data: {
            confirmationRequired: true,
            confirmationStatus: "pending",
            confirmationType: "update_note_tracking",
            changes,
            shared: Object.keys(itemPatch).length > 0,
            payload: {
              noteId,
              itemId: args.itemId,
              updateId: args.updateId,
              itemPatch,
              updatePatch,
              expected: { item, update: update || null },
            },
          },
        };
      },
    },
  ];
}
