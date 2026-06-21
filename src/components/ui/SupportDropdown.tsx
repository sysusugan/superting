import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { HelpCircle, Mail, Bug, BookOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { cn } from "../lib/utils";
import logger from "../../utils/logger";

const PROJECT_URL = "https://github.com/sysusugan/superting";
const PROJECT_DOCS_URL = `${PROJECT_URL}#readme`;
const PROJECT_DISCUSSIONS_URL = `${PROJECT_URL}/discussions`;
const PROJECT_ISSUES_URL = `${PROJECT_URL}/issues`;

interface SupportDropdownProps {
  className?: string;
  trigger?: React.ReactNode;
}

const openExternal = async (url: string) => {
  try {
    const result = await window.electronAPI?.openExternal(url);
    if (!result?.success) {
      logger.error("Failed to open URL", { error: result?.error }, "support");
    }
  } catch (error) {
    logger.error("Error opening URL", { error }, "support");
  }
};

export default function SupportDropdown({ className, trigger }: SupportDropdownProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-foreground/70 hover:text-foreground hover:bg-foreground/10",
              className
            )}
          >
            <HelpCircle size={16} />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openExternal(PROJECT_DOCS_URL)}>
          <BookOpen className="mr-2 h-4 w-4" />
          {t("support.documentation")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            const result = await window.electronAPI?.openExternal(PROJECT_DISCUSSIONS_URL);
            if (!result?.success) {
              openExternal(PROJECT_ISSUES_URL);
            }
          }}
        >
          <Mail className="mr-2 h-4 w-4" />
          {t("support.contactSupport")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openExternal(PROJECT_ISSUES_URL)}>
          <Bug className="mr-2 h-4 w-4" />
          {t("support.submitBug")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
