import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ReasoningService, { type AgentStreamChunk } from "../../services/ReasoningService";
import { getSettings } from "../../stores/settingsStore";
import { getAgentSystemPrompt } from "../../config/prompts";
import { createToolRegistry } from "../../services/tools";
import type { ToolRegistry } from "../../services/tools/ToolRegistry";
import type { Message, AgentState, ToolCallInfo } from "./types";
import { isMissingFinalAnswerAfterToolResult } from "./chatCompletionGuard";
import { isLocalChatProvider, shouldEnableChatTools } from "./toolSupportPolicy";
import type { ActionItem, NoteItem } from "../../types/electron";

const RAG_NOTE_LIMIT = 5;
const RAG_NOTE_SNIPPET_LENGTH = 500;

async function buildRAGContext(userText: string): Promise<string> {
  if (!window.electronAPI?.semanticSearchNotes) return "";
  try {
    const results = await window.electronAPI.semanticSearchNotes(userText, RAG_NOTE_LIMIT);
    if (!results || results.length === 0) return "";

    const snippets = await Promise.all(
      results.map(async (r: { id: number; title: string; score?: number }) => {
        const note = await window.electronAPI.getNote(r.id);
        if (!note) return null;
        const content = (note.content || "").slice(0, RAG_NOTE_SNIPPET_LENGTH);
        return `<note id="${note.id}" title="${note.title}">\n${content}\n</note>`;
      })
    );

    return snippets.filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

interface UseChatStreamingOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Optional note context to prepend to the system prompt (used by embedded note chat). */
  noteContext?: string;
  currentNote?: Pick<
    NoteItem,
    "id" | "title" | "content" | "enhanced_content" | "transcript" | "folder_id" | "updated_at"
  >;
  availableActions?: ActionItem[];
  onStreamComplete?: (assistantId: string, content: string, toolCalls?: ToolCallInfo[]) => void;
}

export interface ChatStreaming {
  agentState: AgentState;
  toolStatus: string;
  activeToolName: string;
  sendToAI: (userText: string, allMessages: Message[]) => Promise<void>;
  cancelStream: () => void;
}

export function useChatStreaming({
  setMessages,
  noteContext: externalNoteContext,
  currentNote,
  availableActions,
  onStreamComplete,
}: UseChatStreamingOptions): ChatStreaming {
  const { t } = useTranslation();
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [toolStatus, setToolStatus] = useState("");
  const [activeToolName, setActiveToolName] = useState("");
  const mountedRef = useRef(true);
  const noteContextRef = useRef(externalNoteContext);
  noteContextRef.current = externalNoteContext;
  const toolRegistryRef = useRef<{ key: string; registry: ToolRegistry } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ReasoningService.cancelActiveStream();
    };
  }, []);

  const cancelStream = useCallback(() => {
    ReasoningService.cancelActiveStream();
    setAgentState("idle");
    setToolStatus("");
    setActiveToolName("");
  }, []);

  const sendToAI = useCallback(
    async (userText: string, allMessages: Message[]) => {
      setAgentState("thinking");

      const settings = getSettings();
      const chatAgentMode = settings.chatAgentMode || "openwhispr";
      const isCloudAgent = chatAgentMode === "openwhispr" && settings.isSignedIn;
      const isLanAgent = chatAgentMode === "self-hosted" && !!settings.chatAgentRemoteUrl;
      const isCustomAgent =
        chatAgentMode === "providers" && settings.chatAgentProvider === "custom";
      const isLocalProvider = isLocalChatProvider(settings.chatAgentProvider);
      const supportsTools = shouldEnableChatTools({
        isCloudAgent,
        chatAgentProvider: settings.chatAgentProvider,
        chatAgentModel: settings.chatAgentModel,
      });

      let registry: ToolRegistry | null = null;
      if (supportsTools) {
        const actionKey = (availableActions ?? [])
          .map((action) => `${action.id}:${action.name}:${action.updated_at}`)
          .join("|");
        const cacheKey = [
          settings.isSignedIn,
          settings.gcalConnected,
          settings.cloudBackupEnabled,
          currentNote?.id ?? "",
          currentNote?.updated_at ?? "",
          actionKey,
        ].join("-");
        if (toolRegistryRef.current?.key === cacheKey) {
          registry = toolRegistryRef.current.registry;
        } else {
          registry = createToolRegistry(
            {
              isSignedIn: settings.isSignedIn,
              gcalConnected: settings.gcalConnected,
              cloudBackupEnabled: settings.cloudBackupEnabled,
            },
            { currentNote, availableActions }
          );
          toolRegistryRef.current = { key: cacheKey, registry };
        }
      }

      const ragContext = await buildRAGContext(userText);
      const combinedContext = [noteContextRef.current, ragContext].filter(Boolean).join("\n\n");
      const systemPrompt = getAgentSystemPrompt(
        registry?.getAll().map((t) => t.name),
        combinedContext || undefined
      );

      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...allMessages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      ];

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);
      setAgentState("streaming");

      try {
        let fullContent = "";
        let contentAfterToolResult = "";
        let sawToolResult = false;
        let toolCallsSnapshot: ToolCallInfo[] = [];
        let stream: AsyncGenerator<AgentStreamChunk>;

        if (isCloudAgent) {
          const executeToolCall = registry
            ? async (name: string, argsJson: string) => {
                const tool = registry.get(name);
                if (!tool)
                  return {
                    data: `Unknown tool: ${name}`,
                    displayText: t("agentMode.tools.unknownTool", { name }),
                  };
                let args: Record<string, unknown>;
                try {
                  args = JSON.parse(argsJson);
                } catch {
                  return {
                    data: `Invalid tool arguments for ${name}`,
                    displayText: t("agentMode.tools.invalidArgs", { name }),
                  };
                }
                const result = await tool.execute(args);
                const data = result.success
                  ? typeof result.data === "string"
                    ? result.data
                    : JSON.stringify(result.data)
                  : result.displayText;
                const metadata =
                  result.success && result.data && typeof result.data === "object"
                    ? (result.data as Record<string, unknown>)
                    : undefined;
                return { data, displayText: result.displayText, metadata };
              }
            : undefined;

          stream = ReasoningService.processTextStreamingCloud(llmMessages, {
            systemPrompt,
            tools: registry?.getAll().map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
            executeToolCall,
          });
        } else {
          const aiTools = registry?.toAISDKFormat();
          stream = ReasoningService.processTextStreamingAI(
            llmMessages,
            settings.chatAgentModel,
            settings.chatAgentProvider,
            {
              systemPrompt,
              lanUrl: isLanAgent ? settings.chatAgentRemoteUrl : undefined,
              baseUrl: isCustomAgent ? settings.chatAgentCloudBaseUrl || undefined : undefined,
              customApiKey: isCustomAgent ? settings.chatAgentCustomApiKey || undefined : undefined,
              disableThinking: settings.chatAgentDisableThinking,
            },
            aiTools
          );
        }

        for await (const chunk of stream) {
          if (!mountedRef.current) {
            ReasoningService.cancelActiveStream();
            break;
          }
          if (chunk.type === "content") {
            fullContent += chunk.text;
            if (sawToolResult) contentAfterToolResult += chunk.text;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
            );
          } else if (chunk.type === "tool_calls") {
            for (const call of chunk.calls) {
              const nextToolCall = {
                id: call.id,
                name: call.name,
                arguments: call.arguments,
                status: "executing" as const,
              };
              toolCallsSnapshot = [...toolCallsSnapshot, nextToolCall];
              setAgentState("tool-executing");
              setActiveToolName(call.name);
              setToolStatus(
                t(`agentMode.tools.${call.name}Status`, { defaultValue: `Using ${call.name}...` })
              );
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: [...(m.toolCalls || []), nextToolCall],
                      }
                    : m
                )
              );
            }
          } else if (chunk.type === "tool_result") {
            sawToolResult = true;
            toolCallsSnapshot = toolCallsSnapshot.map((tc) =>
              tc.id === chunk.callId
                ? {
                    ...tc,
                    status: chunk.isError ? ("error" as const) : ("completed" as const),
                    result: chunk.displayText,
                    ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
                  }
                : tc
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && m.toolCalls
                  ? {
                      ...m,
                      toolCalls: m.toolCalls.map((tc) =>
                        tc.id === chunk.callId
                          ? {
                              ...tc,
                              status: chunk.isError ? ("error" as const) : ("completed" as const),
                              result: chunk.displayText,
                              ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
                            }
                          : tc
                      ),
                    }
                  : m
              )
            );
            setAgentState("streaming");
            setToolStatus("");
            setActiveToolName("");
          }
        }

        const hasToolCalls = toolCallsSnapshot.length > 0;
        if (
          isMissingFinalAnswerAfterToolResult({
            toolCalls: toolCallsSnapshot,
            sawToolResult,
            contentAfterToolResult,
          })
        ) {
          throw new Error(t("agentMode.chat.toolNoFinalAnswer"));
        }
        if (!fullContent.trim() && !hasToolCalls) {
          throw new Error(t("agentMode.chat.emptyResponse"));
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  isStreaming: false,
                  ...(toolCallsSnapshot.length ? { toolCalls: toolCallsSnapshot } : {}),
                }
              : m
          )
        );

        onStreamComplete?.(assistantId, fullContent, toolCallsSnapshot);
      } catch (error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `${t("agentMode.chat.errorPrefix")}: ${(error as Error).message}`,
                  isStreaming: false,
                }
              : m
          )
        );
      }

      setAgentState("idle");
      setToolStatus("");
      setActiveToolName("");
    },
    [availableActions, currentNote, t, setMessages, onStreamComplete]
  );

  return {
    agentState,
    toolStatus,
    activeToolName,
    sendToAI,
    cancelStream,
  };
}
