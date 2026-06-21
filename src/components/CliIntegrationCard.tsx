import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react";
import { CopyableCommand } from "./ui/CopyableCommand";
import { LogoTile } from "./ui/LogoTile";
import logo from "../assets/logo.svg";

const INSTALL_CMD = "npm install -g @superting/cli";
const LOCAL_EXAMPLE = "superting --local notes list";

export default function CliIntegrationCard() {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-border/60 bg-background p-4">
      <div className="flex items-center gap-2 mb-4">
        <LogoTile src={logo} alt="SuperTing" />
        <div className="w-9 h-9 rounded-lg bg-white dark:bg-surface-raised shadow-[0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-none dark:border dark:border-white/5 flex items-center justify-center shrink-0">
          <Terminal className="w-4 h-4 text-foreground/70" strokeWidth={2} />
        </div>
      </div>

      <h3 className="text-sm font-semibold text-foreground mb-1">{t("integrations.cli.title")}</h3>
      <p className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
        {t("integrations.cli.description")}
      </p>

      <div className="mb-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1.5">
          {t("integrations.cli.installLabel")}
        </div>
        <CopyableCommand command={INSTALL_CMD} />
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <h4 className="text-xs font-semibold text-foreground">
            {t("integrations.cli.local.label")}
          </h4>
        </div>
        <p className="text-xs text-muted-foreground/70 mb-2 leading-relaxed">
          {t("integrations.cli.local.description")}
        </p>
        <CopyableCommand command={LOCAL_EXAMPLE} />
      </div>
    </div>
  );
}
