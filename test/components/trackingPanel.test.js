const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const translations = require("../../src/locales/zh-CN/translation.json");
const t = (key) => key.split(".").reduce((value, part) => value?.[part], translations) || key;
const source = fs.readFileSync(
  require.resolve("../../src/components/notes/TrackingPanel.tsx"),
  "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exportsObject = {};
function loadTracking(name) {
  const file = path.resolve(__dirname, "../../src/components/notes", name);
  const filename = fs.existsSync(file + ".tsx") ? file + ".tsx" : file + ".ts";
  const result = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports: result,
      require: (dep) =>
        dep === "react-i18next" ? { useTranslation: () => ({ t }) } : require(dep),
    }
  );
  return result;
}
vm.runInNewContext(compiled, {
  exports: exportsObject,
  require: (name) => {
    if (name === "react-i18next") return { useTranslation: () => ({ t }) };
    if (name === "./TrackingReview") return { __esModule: true, default: () => null };
    if (name.startsWith("../tracking/")) return loadTracking(name);
    return require(name);
  },
});
const render = (data) =>
  renderToStaticMarkup(
    React.createElement(exportsObject.default, {
      data,
      isExtracting: false,
      onExtract() {},
      onReviewSaved() {},
    })
  );
const empty = { newItems: [], matchedItems: [], updates: [], uncertainties: [] };

test("same-title items group interleaved progress by ID without dropping unassigned updates", () => {
  const html = render({
    items: [
      { id: 1, title: "同名", itemType: "项目" },
      { id: 2, title: "同名", itemType: "项目" },
      { id: 3, title: "暂无记录" },
    ],
    updates: [
      { id: 1, item_id: 1, content: "A1" },
      { id: 2, item_id: 2, content: "B1" },
      { id: 3, item_id: 1, content: "A2" },
      { id: 4, item_id: 99, content: "未归属内容" },
    ],
  });
  assert.ok(html.indexOf("A1") < html.indexOf("A2"));
  assert.ok(html.indexOf("A2") < html.indexOf("B1"));
  assert.match(html, /暂无记录/);
  assert.match(html, /未归属进展/);
  assert.match(html, /未归属内容/);
});

test("draft ref grouping retains order and does not merge equal titles", () => {
  const { groupTrackingUpdates } = loadTracking("../tracking/groupTrackingUpdates");
  const items = [
    { ref: "a", title: "Same" },
    { ref: "b", title: "Same" },
  ];
  const updates = [
    { itemRef: "b", content: "B" },
    { itemRef: "a", content: "A" },
    { itemRef: "a", content: "A2" },
    { content: "unknown" },
  ];
  const result = groupTrackingUpdates(
    items,
    updates,
    (i) => i.ref,
    (u) => u.itemRef
  );
  assert.equal(result.groups[0].updates.map((u) => u.content).join(","), "A,A2");
  assert.equal(result.groups[1].updates[0].content, "B");
  assert.equal(result.unassigned[0].content, "unknown");
  assert.equal(updates[0].content, "B");
});

test("confirmed uncertainty-only extraction displays its content and re-extract button", () => {
  const html = render({
    updates: [],
    extractions: [
      {
        id: 3,
        status: "confirmed",
        result: {
          ...empty,
          uncertainties: [
            { title: "数据存储规划", content: "数据库归属尚未确定", evidence: "方案待讨论" },
          ],
        },
      },
    ],
  });
  assert.match(html, /数据库归属尚未确定/);
  assert.match(html, /方案待讨论/);
  assert.match(html, /重新提取/);
});

test("empty confirmed result explains there are no extracted items", () => {
  assert.match(
    render({ updates: [], extractions: [{ id: 4, status: "confirmed", result: empty }] }),
    /未提取到/
  );
});

test("rejected result remains visible and can be extracted again", () => {
  assert.match(
    render({ updates: [], extractions: [{ id: 5, status: "rejected", result: empty }] }),
    /重新提取/
  );
});

test("confirmed items without updates remain visible", () => {
  assert.match(
    render({
      items: [{ id: 1, title: "已校正事项名称", itemType: "商机", state: "进行中" }],
      updates: [],
      extractions: [
        {
          id: 6,
          status: "confirmed",
          result: {
            ...empty,
            newItems: [{ title: "客户评估商机", itemType: "商机" }],
          },
        },
      ],
    }),
    /已校正事项名称/
  );
});
