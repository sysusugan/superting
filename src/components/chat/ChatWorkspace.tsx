import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The header and composer stay outside the independently scrolling message list. */
export function ChatWorkspace({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="ow-chat-workspace flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
      <div className="ow-page-column ow-page-column--fluid h-auto shrink-0 pb-0">
        <div className="ow-page-header mb-0">
          <div className="ow-page-heading">
            <h1 className="ow-page-title">{t("sidebar.chat")}</h1>
            <p className="ow-page-description">{t("chat.newChatEmpty")}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
