import { useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { ChatMessage } from "./ChatMessage";
import type { Message, ToolCallInfo } from "./types";

interface ChatMessagesProps {
  messages: Message[];
  emptyState?: React.ReactNode;
  onOpenNote?: (noteId: number) => void;
  onConfirmToolCall?: (toolCall: ToolCallInfo) => void;
  onCancelToolCall?: (toolCall: ToolCallInfo) => void;
  onWriteAssistantMessage?: (
    content: string,
    target: "content" | "enhanced_content",
    writeMode: "overwrite" | "append"
  ) => void;
}

export function ChatMessages({
  messages,
  emptyState,
  onOpenNote,
  onConfirmToolCall,
  onCancelToolCall,
  onWriteAssistantMessage,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto agent-chat-scroll")}>
      {messages.length === 0 ? (
        (emptyState ?? null)
      ) : (
        <div className="ow-chat-stream">
          {messages
            .filter((msg) => msg.role !== "tool")
            .map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role as "user" | "assistant"}
                content={msg.content}
                isStreaming={msg.isStreaming}
                toolCalls={msg.toolCalls}
                onOpenNote={onOpenNote}
                onConfirmToolCall={onConfirmToolCall}
                onCancelToolCall={onCancelToolCall}
                onWriteAssistantMessage={onWriteAssistantMessage}
              />
            ))}
        </div>
      )}
    </div>
  );
}
