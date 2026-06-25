import assert from "node:assert/strict";
import test from "node:test";
import { serializeMarkdownTableNode } from "../../src/utils/markdownTable.ts";

type FakeNode = {
  type?: { name?: string };
  attrs?: Record<string, unknown>;
  content?: { size?: number };
  textContent?: string;
  children?: FakeNode[];
  forEach?: (callback: (node: FakeNode, offset: number, index: number) => void) => void;
  textBetween?: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
};

function node(type: string, children: FakeNode[] = [], text = "", attrs: Record<string, unknown> = {}): FakeNode {
  const fake: FakeNode = {
    type: { name: type },
    attrs,
    content: { size: text.length },
    textContent: text,
    children,
    forEach(callback) {
      children.forEach((child, index) => callback(child, index, index));
    },
    textBetween() {
      if (text) return text;
      return children.map((child) => child.textBetween?.(0, 0, "\n", " ") ?? child.textContent ?? "").join("\n");
    },
  };
  return fake;
}

const cell = (text: string, attrs: Record<string, unknown> = {}) => node("tableCell", [], text, attrs);
const header = (text: string, attrs: Record<string, unknown> = {}) => node("tableHeader", [], text, attrs);
const row = (...cells: FakeNode[]) => node("tableRow", cells);
const tableNode = (...rows: FakeNode[]) => node("table", rows);

test("serializes rich text table nodes as markdown pipe tables", () => {
  const markdown = serializeMarkdownTableNode(
    tableNode(
      row(header("Task"), header("Owner")),
      row(cell("Pull data"), cell("Shijia")),
      row(cell("Update rubric"), cell("Shijia"))
    )
  );

  assert.equal(
    markdown,
    [
      "| Task          | Owner  |",
      "| ------------- | ------ |",
      "| Pull data     | Shijia |",
      "| Update rubric | Shijia |",
    ].join("\n")
  );
});

test("serializes tables without a header row without falling back to placeholders", () => {
  const markdown = serializeMarkdownTableNode(tableNode(row(cell("A"), cell("B"))));

  assert.equal(markdown, ["|     |     |", "| --- | --- |", "| A   | B   |"].join("\n"));
  assert.doesNotMatch(markdown, /\[table\]/);
});

test("escapes table cell pipes and keeps multiline cell content readable", () => {
  const markdown = serializeMarkdownTableNode(
    tableNode(row(header("Risk | Level", { align: "center" })), row(cell("Line 1\nLine | 2")))
  );

  assert.equal(
    markdown,
    ["| Risk \\| Level       |", "| :-------------------: |", "| Line 1<br>Line \\| 2 |"].join("\n")
  );
});
