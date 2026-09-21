const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const i18next = require("i18next");
const { I18nextProvider } = require("react-i18next");

function loadComponent(file) {
  const localRequire = createRequire(file);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name.endsWith("/actionProcessingStore"))
        return {
          useActionProcessingStore: (select) => select({ batch: { running: false, entries: [] } }),
        };
      if (name.endsWith("/settingsStore"))
        return {
          useSettingsStore: () => ({}),
          selectResolvedNoteFormatting: () => ({ model: "test" }),
          selectIsCloudNoteFormattingMode: () => false,
        };
      if (name.startsWith(".")) {
        const candidate = path.resolve(path.dirname(file), `${name}.tsx`);
        if (fs.existsSync(candidate)) return loadComponent(candidate);
        const plain = path.resolve(path.dirname(file), `${name}.ts`);
        if (fs.existsSync(plain)) return loadComponent(plain);
      }
      return localRequire(name);
    },
  });
  return exports;
}

test("chat layout keeps a nonshrinking header outside message and composer slots", () => {
  const Workspace = loadComponent(
    path.resolve(__dirname, "../../src/components/chat/ChatWorkspace.tsx")
  ).ChatWorkspace;
  const html = renderToStaticMarkup(
    React.createElement(Workspace, null, React.createElement("div", { "data-message-slot": true }))
  );
  assert.match(html, /min-h-0/);
  assert.match(html, /overflow-hidden/);
  assert.match(html, /ow-page-column[^"]*shrink-0/);
  assert.ok(html.indexOf("ow-page-title") < html.indexOf("data-message-slot"));
});

test("tracking center offers localized inventory and read-only template tabs without unfinished actions", async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: require("../../src/locales/zh-CN/translation.json") } },
  });
  const Center = loadComponent(
    path.resolve(__dirname, "../../src/components/TrackingCenter.tsx")
  ).default;
  const html = renderToStaticMarkup(
    React.createElement(
      I18nextProvider,
      { i18n },
      React.createElement(Center, { active: true, request: null, onOpenNote() {} })
    )
  );
  assert.match(html, /事项中心/);
  assert.match(html, /<h1 class="ow-page-title"/);
  assert.match(html, /ow-page-column ow-page-column--fluid/);
  assert.match(html, /搜索事项/);
  assert.match(html, /批量提取/);
  assert.match(html, /待确认/);
  assert.match(html, /role="tab"[^>]*>模板/);
  assert.doesNotMatch(html, /trackingCenter\./);
  assert.doesNotMatch(html, /合并事项|删除事项|确认全部/);
});
