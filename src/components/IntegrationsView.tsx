import { useTranslation } from "react-i18next";
import McpIntegrationCard from "./McpIntegrationCard";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-2 pl-1">
      {children}
    </div>
  );
}

export default function IntegrationsView() {
  const { t } = useTranslation();

  return (
    <div className="ow-workspace-page">
      <div className="ow-page-column">
        <div className="ow-page-header">
          <div className="ow-page-heading">
            <h1 className="ow-page-title">{t("integrations.title")}</h1>
            <p className="ow-page-description">{t("integrations.description")}</p>
          </div>
        </div>

        <div className="ow-page-body">
          <section className="ow-section max-w-3xl">
            <SectionLabel>{t("integrations.sections.mcp")}</SectionLabel>
            <McpIntegrationCard />
          </section>
        </div>
      </div>
    </div>
  );
}
