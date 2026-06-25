interface ProseMirrorNodeLike {
  type?: { name?: string };
  attrs?: Record<string, unknown>;
  content?: { size?: number };
  textContent?: string;
  childCount?: number;
  forEach?: (callback: (node: ProseMirrorNodeLike, offset: number, index: number) => void) => void;
  textBetween?: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
}

interface MarkdownCell {
  text: string;
  align: "left" | "right" | "center" | null;
  isHeader: boolean;
}

function getChildNodes(node: ProseMirrorNodeLike): ProseMirrorNodeLike[] {
  const children: ProseMirrorNodeLike[] = [];
  node.forEach?.((child) => children.push(child));
  return children;
}

function normalizeSpan(value: unknown): number {
  const span = typeof value === "number" ? value : Number(value);
  return Number.isFinite(span) && span > 1 ? Math.floor(span) : 1;
}

function normalizeAlign(value: unknown): MarkdownCell["align"] {
  return value === "left" || value === "right" || value === "center" ? value : null;
}

function escapeTableCell(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("<br>")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
}

function getCellText(cell: ProseMirrorNodeLike): string {
  const size = cell.content?.size ?? 0;
  const raw =
    typeof cell.textBetween === "function"
      ? cell.textBetween(0, size, "\n", " ")
      : cell.textContent ?? "";

  return escapeTableCell(raw);
}

function getMarkdownRows(table: ProseMirrorNodeLike): MarkdownCell[][] {
  return getChildNodes(table).map((row) => {
    const cells: MarkdownCell[] = [];

    getChildNodes(row).forEach((cell) => {
      const colspan = normalizeSpan(cell.attrs?.colspan);
      cells.push({
        text: getCellText(cell),
        align: normalizeAlign(cell.attrs?.align),
        isHeader: cell.type?.name === "tableHeader",
      });

      for (let index = 1; index < colspan; index += 1) {
        cells.push({ text: "", align: null, isHeader: cell.type?.name === "tableHeader" });
      }
    });

    return cells;
  });
}

function getDelimiter(width: number, align: MarkdownCell["align"]): string {
  const dashes = "-".repeat(Math.max(3, width));
  if (align === "left") return `:${dashes}`;
  if (align === "right") return `${dashes}:`;
  if (align === "center") return `:${dashes}:`;
  return dashes;
}

export function serializeMarkdownTableNode(table: ProseMirrorNodeLike): string {
  const rows = getMarkdownRows(table).filter((row) => row.length > 0);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  if (!columnCount) return "";

  const hasHeaderRow = rows[0]?.some((cell) => cell.isHeader) ?? false;
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      3,
      ...rows.map((row) => row[columnIndex]?.text.length ?? 0)
    )
  );
  const alignments = Array.from(
    { length: columnCount },
    (_, columnIndex) => rows.find((row) => row[columnIndex]?.align)?.[columnIndex]?.align ?? null
  );
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));
  const renderRow = (row: MarkdownCell[]) =>
    `| ${columnWidths
      .map((width, columnIndex) => pad(row[columnIndex]?.text ?? "", width))
      .join(" | ")} |`;

  const header = hasHeaderRow ? rows[0] : [];
  const bodyRows = hasHeaderRow ? rows.slice(1) : rows;
  const delimiter = `| ${columnWidths
    .map((width, columnIndex) => getDelimiter(width, alignments[columnIndex]))
    .join(" | ")} |`;

  return [renderRow(header), delimiter, ...bodyRows.map(renderRow)].join("\n");
}
