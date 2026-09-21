import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "../../src/locales/zh-CN/translation.json";
import { ChatWorkspace } from "../../src/components/chat/ChatWorkspace";
import { ChatMessages } from "../../src/components/chat/ChatMessages";
import { ChatInput } from "../../src/components/chat/ChatInput";
import "../../src/index.css";

await i18n
  .use(initReactI18next)
  .init({ lng: "zh-CN", resources: { "zh-CN": { translation: zh } } });
createRoot(document.getElementById("root")!).render(
  <div style={{ height: 600, display: "flex" }}>
    <ChatWorkspace>
      <ChatMessages
        messages={[]}
        emptyState={<div style={{ height: 2000 }}>Long message fixture</div>}
      />
      <ChatInput agentState="idle" partialTranscript="" />
    </ChatWorkspace>
  </div>
);
