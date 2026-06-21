import React, { useState } from "react";
import {
  Home,
  MessageSquare,
  NotebookPen,
  BookOpen,
  Upload,
  Blocks,
  Settings,
  HelpCircle,
  UserCircle,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import logoIcon from "../assets/icon.png";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import SupportDropdown from "./ui/SupportDropdown";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

export type ControlPanelView =
  | "home"
  | "chat"
  | "personal-notes"
  | "dictionary"
  | "upload"
  | "integrations";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  updateAction?: React.ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  userName,
  userEmail,
  userImage,
  updateAction,
  collapsed = false,
  onCollapsedChange,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const collapseLabel = t("sidebar.collapse");
  const expandLabel = t("sidebar.expand");

  const navItems: {
    id: ControlPanelView;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }[] = [
    { id: "home", label: t("sidebar.home"), icon: Home },
    { id: "chat", label: t("sidebar.chat"), icon: MessageSquare },
    { id: "personal-notes", label: t("sidebar.notes"), icon: NotebookPen },
    { id: "upload", label: t("sidebar.upload"), icon: Upload },
    { id: "dictionary", label: t("sidebar.dictionary"), icon: BookOpen },
    { id: "integrations", label: t("sidebar.integrations"), icon: Blocks },
  ];

  if (collapsed) {
    return (
      <div className="ow-surface-pane w-[4.5rem] h-full shrink-0 flex flex-col items-center">
        <div
          className="w-full h-10 shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          title={expandLabel}
          aria-label={expandLabel}
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <PanelLeftOpen size={18} />
        </button>

        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            title={t("commandSearch.shortPlaceholder")}
            aria-label={t("commandSearch.shortPlaceholder")}
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
          >
            <Search size={18} />
          </button>
        )}

        <nav className="flex flex-col items-center gap-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onViewChange(item.id)}
                title={item.label}
                aria-label={item.label}
                className={cn(
                  "ow-nav-item flex h-10 w-10 justify-center px-0",
                  isActive
                    ? "ow-nav-item-active"
                    : ""
                )}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1 pb-3">
          <button
            type="button"
            onClick={onOpenSettings}
            title={t("sidebar.settings")}
            aria-label={t("sidebar.settings")}
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
          >
            <Settings size={17} />
          </button>

          <SupportDropdown
            trigger={
              <button
                type="button"
                title={t("sidebar.support")}
                aria-label={t("sidebar.support")}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
              >
                <HelpCircle size={17} />
              </button>
            }
          />

          <div className="my-2 h-px w-10 bg-border/70" />

          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-card/60"
            title={userName || userEmail || t("sidebar.defaultUser")}
          >
            {userImage ? (
              <img src={userImage} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <UserCircle size={20} className="text-muted-foreground" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ow-surface-pane h-full w-full shrink-0 flex flex-col">
      <div
        className="w-full h-10 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <div
        className="flex items-center justify-between gap-2 min-w-0 px-5 pb-4"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 min-w-0">
          <img src={logoIcon} alt="" className="w-6 h-6 rounded-md shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">SuperTing</span>
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(true)}
          title={collapseLabel}
          aria-label={collapseLabel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {onOpenSearch && (
        <div className="px-4 pt-2 pb-2">
          <button
            onClick={onOpenSearch}
            className="ow-command-field group h-10 px-3"
          >
            <Search size={15} className="text-muted-foreground shrink-0" />
            <span className="flex-1 text-xs text-left font-medium text-muted-foreground">
              {t("commandSearch.shortPlaceholder")}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <kbd className="text-[10px] px-1 py-px rounded-sm border border-border/70 bg-background text-muted-foreground font-mono leading-tight">
                {platform === "darwin" ? "⌘" : "Ctrl"}
              </kbd>
              <kbd className="text-[10px] px-1 py-px rounded-sm border border-border/70 bg-background text-muted-foreground font-mono leading-tight">
                K
              </kbd>
            </div>
          </button>
        </div>
      )}

      <nav className="flex flex-col gap-1 px-4 pt-2 pb-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "ow-nav-item group h-10",
                isActive && "ow-nav-item-active"
              )}
            >
              <Icon
                size={16}
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span
                className={cn(
                  "text-sm transition-colors duration-150",
                  isActive ? "font-semibold" : "font-semibold"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="px-4 pb-3 space-y-1">
        {updateAction && (
          <div className="px-1 pb-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {updateAction}
          </div>
        )}

        <button
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
          className="ow-nav-item group h-10"
        >
          <Settings
            size={15}
            className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors duration-150"
          />
          <span className="text-sm font-semibold transition-colors duration-150">
            {t("sidebar.settings")}
          </span>
        </button>

        <SupportDropdown
          trigger={
            <button
              aria-label={t("sidebar.support")}
              className="ow-nav-item group h-10"
            >
              <HelpCircle
                size={15}
                className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors duration-150"
              />
              <span className="text-sm font-semibold transition-colors duration-150">
                {t("sidebar.support")}
              </span>
            </button>
          }
        />

      </div>
    </div>
  );
}
