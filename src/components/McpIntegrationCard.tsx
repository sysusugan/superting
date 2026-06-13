import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Power, RefreshCw, Server, Shield } from "lucide-react";
import { Button } from "./ui/button";
import { CopyableCommand } from "./ui/CopyableCommand";
import { LogoTile } from "./ui/LogoTile";
import logo from "../assets/logo.svg";

interface McpStatus {
  enabled: boolean;
  running: boolean;
  url: string | null;
  port: number | null;
  hasToken: boolean;
  token?: string | null;
  metadataPath?: string | null;
}

const EMPTY_STATUS: McpStatus = {
  enabled: false,
  running: false,
  url: null,
  port: null,
  hasToken: false,
  token: null,
  metadataPath: null,
};

export default function McpIntegrationCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<McpStatus>(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const next = await window.electronAPI?.getMcpServerStatus?.();
    if (next) setStatus(next);
  }, []);

  useEffect(() => {
    loadStatus().catch((err) => setError((err as Error).message));
  }, [loadStatus]);

  const codexConfig = useMemo(() => {
    if (!status.url) return "";
    return [
      "[mcp_servers.openwhispr]",
      `url = "${status.url}"`,
      'bearer_token_env_var = "OPENWHISPR_MCP_TOKEN"',
      'default_tools_approval_mode = "prompt"',
    ].join("\n");
  }, [status.url]);

  const toggleServer = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI?.setMcpServerEnabled?.(!status.enabled);
      if (!result?.success) throw new Error(result?.error || "MCP server update failed");
      if (result.status) setStatus(result.status);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [status.enabled]);

  const rotateToken = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI?.rotateMcpServerToken?.();
      if (!result?.success) throw new Error(result?.error || "MCP token rotation failed");
      if (result.status) setStatus(result.status);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="rounded-md border border-border/60 bg-background p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <LogoTile src={logo} alt="OpenWhispr" />
          <div className="w-9 h-9 rounded-lg bg-white dark:bg-surface-raised shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-none dark:border dark:border-white/5 flex items-center justify-center shrink-0">
            <Server className="w-4 h-4 text-foreground/70" strokeWidth={2} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
              status.running ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {status.running && <CheckCircle2 className="w-3.5 h-3.5" />}
            {status.running
              ? t("integrations.mcp.status.running")
              : t("integrations.mcp.status.off")}
          </span>
          <Button
            size="sm"
            variant={status.enabled ? "outline" : "default"}
            onClick={toggleServer}
            disabled={busy}
          >
            <Power className="w-3.5 h-3.5" />
            {status.enabled
              ? t("integrations.mcp.actions.disable")
              : t("integrations.mcp.actions.enable")}
          </Button>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-foreground mb-1">{t("integrations.mcp.title")}</h3>
      <p className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
        {t("integrations.mcp.description")}
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {status.running && status.url && status.token ? (
        <div className="space-y-3">
          <CopyableCommand label={t("integrations.mcp.urlLabel")} command={status.url} />
          <CopyableCommand label={t("integrations.mcp.tokenLabel")} command={status.token} />
          <CopyableCommand label={t("integrations.mcp.codexConfigLabel")} command={codexConfig} />
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="w-3.5 h-3.5" />
              <span>{t("integrations.mcp.securityNote")}</span>
            </div>
            <Button size="sm" variant="outline" onClick={rotateToken} disabled={busy}>
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
              {t("integrations.mcp.actions.rotateToken")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
          {t("integrations.mcp.disabledState")}
        </div>
      )}
    </div>
  );
}
