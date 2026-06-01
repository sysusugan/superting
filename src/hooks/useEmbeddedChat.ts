import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChatPersistence } from "../components/chat/useChatPersistence";
import { useChatStreaming } from "../components/chat/useChatStreaming";
import type { Message, AgentState, ToolCallInfo } from "../components/chat/types";
import { initializeActions, useActions, getActionName } from "../stores/actionStore";
import type { ActionItem } from "../types/electron";
import {
  selectIsCloudNoteFormattingMode,
  selectResolvedNoteFormatting,
  useSettingsStore,
} from "../stores/settingsStore";
import { runNoteActionOnce } from "../stores/runNoteActionOnce";
import { buildWriteNoteContentUpdates } from "../stores/actionProcessingCore";
import { syncService } from "../services/SyncService";
import { createPendingRunNoteActionToolCall } from "./embeddedChatActions";

interface UseEmbeddedChatOptions {
  noteId: number | null;
  folderId: number | null;
  noteTitle: string;
  noteContent: string;
  noteEnhancedContent?: string | null;
  noteTranscript?: string;
  noteUpdatedAt?: string;
}

interface NoteConversationItem {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface UseEmbeddedChatReturn {
  messages: Message[];
  agentState: AgentState;
  sendMessage: (text: string) => Promise<void>;
  cancelStream: () => void;
  noteConversations: NoteConversationItem[];
  activeConversationId: number | null;
  actions: ActionItem[];
  switchConversation: (id: number) => Promise<void>;
  startNewChat: () => void;
  requestRunNoteAction: (action: ActionItem) => Promise<void>;
  confirmToolCall: (toolCall: ToolCallInfo) => Promise<void>;
  cancelToolCall: (toolCall: ToolCallInfo) => void;
  writeAssistantMessage: (
    content: string,
    target: "content" | "enhanced_content",
    writeMode: "overwrite" | "append"
  ) => Promise<void>;
}

export function useEmbeddedChat({
  noteId,
  folderId,
  noteTitle,
  noteContent,
  noteEnhancedContent,
  noteTranscript,
  noteUpdatedAt,
}: UseEmbeddedChatOptions): UseEmbeddedChatReturn {
  const { t } = useTranslation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [noteConversations, setNoteConversations] = useState<NoteConversationItem[]>([]);
  const actions = useActions();
  const noteIdRef = useRef(noteId);
  const actionsRef = useRef(actions);
  const [prevNoteId, setPrevNoteId] = useState(noteId);

  const persistence = useChatPersistence({
    conversationId,
    onConversationCreated: (id) => {
      setConversationId(id);
    },
  });

  const noteContext = useMemo(
    () =>
      [
        `Note ID: ${noteId}`,
        folderId != null ? `Folder ID: ${folderId}` : "",
        `Title: ${noteTitle}`,
        `Content:\n${noteContent}`,
        noteTranscript ? `\nTranscript:\n${noteTranscript}` : "",
        actions.length
          ? `\nAvailable custom note actions:\n${actions
              .map((action) => `- ${action.id}: ${action.name}`)
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    [actions, folderId, noteContent, noteId, noteTitle, noteTranscript]
  );

  const currentNote = useMemo(
    () =>
      noteId == null
        ? undefined
        : {
            id: noteId,
            title: noteTitle,
            content: noteContent,
            enhanced_content: noteEnhancedContent ?? null,
            transcript: noteTranscript ?? null,
            folder_id: folderId,
            updated_at: noteUpdatedAt ?? "",
          },
    [folderId, noteContent, noteEnhancedContent, noteId, noteTitle, noteTranscript, noteUpdatedAt]
  );

  const streaming = useChatStreaming({
    setMessages: persistence.setMessages,
    noteContext,
    currentNote,
    availableActions: actions,
    onStreamComplete: (_id, content, toolCalls) => {
      persistence.saveAssistantMessage(content, toolCalls);
    },
  });

  useEffect(() => {
    initializeActions();
  }, []);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const fetchNoteConversations = useCallback(async () => {
    if (!noteId) return;
    const conversations = await window.electronAPI?.getConversationsForNote?.(noteId);
    if (noteIdRef.current !== noteId) return;
    setNoteConversations(conversations ?? []);
    return conversations ?? [];
  }, [noteId]);

  if (noteId !== prevNoteId) {
    setPrevNoteId(noteId);
    if (!noteId) {
      persistence.handleNewChat();
      setConversationId(null);
      setNoteConversations([]);
    }
  }

  useEffect(() => {
    noteIdRef.current = noteId;
    if (!noteId) return;

    let stale = false;
    (async () => {
      const conversations = await window.electronAPI?.getConversationsForNote?.(noteId);
      if (stale || noteIdRef.current !== noteId) return;
      setNoteConversations(conversations ?? []);
      if (conversations?.length) {
        const mostRecent = conversations[0];
        await persistence.loadConversation(mostRecent.id);
        if (stale || noteIdRef.current !== noteId) return;
        setConversationId(mostRecent.id);
      } else {
        persistence.handleNewChat();
        setConversationId(null);
      }
    })();

    return () => {
      stale = true;
    };
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchToolCall = useCallback(
    (toolCallId: string, patch: Partial<ToolCallInfo>) => {
      persistence.setMessages((prev) =>
        prev.map((message) =>
          message.toolCalls?.some((toolCall) => toolCall.id === toolCallId)
            ? {
                ...message,
                toolCalls: message.toolCalls.map((toolCall) =>
                  toolCall.id === toolCallId ? { ...toolCall, ...patch } : toolCall
                ),
              }
            : message
        )
      );
    },
    [persistence]
  );

  const cancelToolCall = useCallback(
    (toolCall: ToolCallInfo) => {
      patchToolCall(toolCall.id, {
        status: "completed",
        result: t("embeddedChat.confirmation.cancelled"),
        metadata: {
          ...(toolCall.metadata ?? {}),
          confirmationStatus: "cancelled",
        },
      });
    },
    [patchToolCall, t]
  );

  const writeAssistantMessage = useCallback(
    async (
      content: string,
      target: "content" | "enhanced_content",
      writeMode: "overwrite" | "append"
    ) => {
      if (!noteIdRef.current) return;
      const note = await window.electronAPI.getNote(noteIdRef.current);
      if (!note) throw new Error(t("embeddedChat.confirmation.noteNotFound"));

      const updates = buildWriteNoteContentUpdates({
        target,
        writeMode,
        content,
        existingContent: note.content,
        existingEnhancedContent: note.enhanced_content,
      });
      const result = await window.electronAPI.updateNote(note.id, updates);
      if (!result.success) throw new Error(t("embeddedChat.confirmation.writeFailed"));
      syncService.debouncedPush("note", note.id);
    },
    [t]
  );

  const confirmToolCall = useCallback(
    async (toolCall: ToolCallInfo) => {
      const metadata = toolCall.metadata ?? {};
      const payload = metadata.payload as Record<string, unknown> | undefined;
      const confirmationType = metadata.confirmationType;
      if (!payload || metadata.confirmationStatus === "confirmed") return;

      patchToolCall(toolCall.id, { status: "executing" });
      try {
        if (confirmationType === "write_note_content") {
          await writeAssistantMessage(
            String(payload.content ?? ""),
            payload.target === "content" ? "content" : "enhanced_content",
            payload.writeMode === "overwrite" ? "overwrite" : "append"
          );
          patchToolCall(toolCall.id, {
            status: "completed",
            result: t("embeddedChat.confirmation.written"),
            metadata: { ...metadata, confirmationStatus: "confirmed" },
          });
          return;
        }

        if (confirmationType === "run_note_action") {
          const noteIdFromPayload = Number(payload.noteId);
          if (noteIdFromPayload !== noteIdRef.current) {
            throw new Error(t("embeddedChat.confirmation.currentNoteOnly"));
          }
          const actionId = Number(payload.actionId);
          const action = actionsRef.current.find((item) => item.id === actionId);
          if (!action) throw new Error(t("embeddedChat.confirmation.actionNotFound"));
          const note = await window.electronAPI.getNote(noteIdFromPayload);
          if (!note) throw new Error(t("embeddedChat.confirmation.noteNotFound"));

          const settings = useSettingsStore.getState();
          const resolved = selectResolvedNoteFormatting(settings);
          const isCloudMode = selectIsCloudNoteFormattingMode(settings);
          const { updates } = await runNoteActionOnce({
            note,
            action,
            modelId: resolved.model,
            isCloudMode,
            speakerLabels: {
              you: t("notes.speaker.you"),
              them: t("notes.speaker.them"),
            },
          });
          const result = await window.electronAPI.updateNote(note.id, updates);
          if (!result.success) throw new Error(t("embeddedChat.confirmation.writeFailed"));
          syncService.debouncedPush("note", note.id);
          patchToolCall(toolCall.id, {
            status: "completed",
            result: t("embeddedChat.confirmation.actionCompleted", { name: action.name }),
            metadata: { ...metadata, confirmationStatus: "confirmed" },
          });
        }
      } catch (error) {
        patchToolCall(toolCall.id, {
          status: "error",
          result: (error as Error).message,
          metadata: { ...metadata, confirmationStatus: "pending" },
        });
      }
    },
    [patchToolCall, t, writeAssistantMessage]
  );

  const switchConversation = useCallback(
    async (id: number) => {
      await persistence.loadConversation(id);
      setConversationId(id);
    },
    [persistence]
  );

  const startNewChat = useCallback(() => {
    persistence.handleNewChat();
    setConversationId(null);
  }, [persistence]);

  const requestRunNoteAction = useCallback(
    async (action: ActionItem) => {
      if (!noteIdRef.current) return;
      let convId = conversationId;
      if (!convId) {
        const title = `Note: ${noteTitle || "Untitled"}`;
        convId = await persistence.createConversation(title, noteIdRef.current);
        setConversationId(convId);
        fetchNoteConversations();
      }

      const toolCall = createPendingRunNoteActionToolCall({
        actionId: action.id,
        actionName: getActionName(action, t),
        noteId: noteIdRef.current,
      });
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: false,
        toolCalls: [toolCall],
      };

      persistence.setMessages((prev) => [...prev, assistantMessage]);
      await persistence.saveAssistantMessage("", [toolCall]);
    },
    [conversationId, fetchNoteConversations, noteTitle, persistence, t]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      let convId = conversationId;
      if (!convId) {
        const title = `Note: ${noteTitle || "Untitled"}`;
        convId = await persistence.createConversation(title, noteId);
        fetchNoteConversations();
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        isStreaming: false,
      };
      persistence.setMessages((prev) => [...prev, userMsg]);
      await persistence.saveUserMessage(text);

      const allMessages = [...persistence.messages, userMsg];
      await streaming.sendToAI(text, allMessages);
    },
    [conversationId, noteId, noteTitle, persistence, streaming, fetchNoteConversations]
  );

  return {
    messages: persistence.messages,
    agentState: streaming.agentState,
    sendMessage,
    cancelStream: streaming.cancelStream,
    noteConversations,
    activeConversationId: conversationId,
    actions,
    switchConversation,
    startNewChat,
    requestRunNoteAction,
    confirmToolCall,
    cancelToolCall,
    writeAssistantMessage,
  };
}
