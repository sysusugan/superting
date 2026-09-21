const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
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
vm.runInNewContext(compiled, {
  exports: exportsObject,
  require: (name) => {
    if (name === "react-i18next") return { useTranslation: () => ({ t }) };
    if (name === "./TrackingReview") return { __esModule: true, default: () => null };
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
