// Manual UI fixture: in-memory IPC boundary only; never loads the user's database.
// Run Vite from the repo root with --config src/vite.config.mjs (use the actual config extension).
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "../../src/locales/zh-CN/translation.json";
import TrackingCenter from "../../src/components/TrackingCenter";
import "../../src/index.css";

await i18n
  .use(initReactI18next)
  .init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh } },
    interpolation: { escapeValue: false },
  });
const template = {
  id: 1,
  name: "项目",
  version: 1,
  definition: {
    fields: ["客户", "负责人"],
    states: ["进行中", "暂停", "已完成"],
    updateTypes: ["进展", "风险"],
  },
};
const rows = Array.from({ length: 31 }, (_, i) => ({
  id: i + 1,
  template_id: 1,
  title: `验证项目 ${i + 1}`,
  itemType: "项目",
  state: "进行中",
  properties: { 客户: "测试客户", 负责人: "测试负责人", 历史属性: "保留原值" },
  isActive: true,
  is_active: 1,
  state_source_update_id: null,
  manual_state: 0,
  created_at: "2026-09-21 09:00:00",
  updated_at: "2026-09-21 09:00:00",
}));
const operations: Record<number, unknown[]> = {};
let failure = false;
const detail = (id: number) => ({
  item: structuredClone(rows.find((row) => row.id === id)),
  updates: { items: [], total: 0, page: 1 },
  notes: [{ id: 1, title: "来源笔记（测试）", folder_id: null, deleted_at: null }],
  relations: [],
  operations: operations[id] || [],
});
window.electronAPI = {
  async getTrackingTemplates() {
    return [template];
  },
  async listTrackingItems(query = {}) {
    if (failure) throw new Error("Fixture: load failed");
    const matches = rows.filter(
      (row) =>
        row.title.includes(query.search || "") &&
        (!query.state || row.state === query.state) &&
        (query.active === "inactive"
          ? !row.isActive
          : query.active === "active"
            ? row.isActive
            : true)
    );
    const page = query.page || 1;
    return {
      items: structuredClone(matches.slice((page - 1) * 30, page * 30)),
      total: matches.length,
      page,
      states: template.definition.states,
    };
  },
  async getTrackingItemDetail(id) {
    if (failure) throw new Error("Fixture: detail failed");
    return detail(id);
  },
  async updateTrackingItem(id, { expected, patch }) {
    const item = rows.find((row) => row.id === id)!;
    if (JSON.stringify(item) !== JSON.stringify(expected))
      return { success: false, error: "Fixture: record changed, refresh required" };
    const before = structuredClone(item);
    Object.assign(item, { ...patch, properties: { ...item.properties, ...patch.properties } });
    for (const key of patch.removePropertyKeys || []) delete item.properties[key];
    delete item.removePropertyKeys;
    operations[id] = [
      {
        id: 1,
        operation: "edit-item",
        created_at: "2026-09-21 09:01:00",
        before_json: JSON.stringify(before),
        after_json: JSON.stringify(item),
        entrypoint: "center",
      },
    ];
    return { success: true, data: detail(id) };
  },
} as unknown as Window["electronAPI"];

function Fixture() {
  const [active, setActive] = useState(true);
  const [source, setSource] = useState("");
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="flex gap-4 bg-muted p-2 text-xs">
        <button
          onClick={() => {
            if (
              window.dispatchEvent(new Event("superting-before-navigation", { cancelable: true }))
            )
              setActive(!active);
          }}
        >
          Toggle navigation
        </button>
        <button
          onClick={() => {
            rows[0].title = "Concurrent change";
          }}
        >
          Simulate conflict on item 1
        </button>
        <button
          onClick={() => {
            failure = !failure;
            window.dispatchEvent(new Event("superting-tracking-updated"));
          }}
        >
          Toggle load failure
        </button>
        <span>{source}</span>
      </div>
      <div className={active ? "min-h-0 flex-1" : "hidden"}>
        <TrackingCenter
          active={active}
          request={null}
          onOpenNote={(id) => {
            setSource(`Source note ${id}`);
            setActive(false);
          }}
        />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
