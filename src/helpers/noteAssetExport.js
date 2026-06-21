const fs = require("fs");
const path = require("path");
const { getAssetIdFromUrl, isNoteAssetUrl, readNoteAssetBuffer } = require("./noteAssetStorage");
const { BRAND } = require("./brandConfig");

function safeExportName(value) {
  return String(value || "image")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .slice(0, 80);
}

function safeMarkdownAlt(value) {
  return (
    String(value || "image")
      .replace(/[\[\]\r\n]/g, " ")
      .trim() || "image"
  );
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readHtmlAttribute(attrs, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  const match = String(attrs || "").match(pattern);
  return match ? decodeHtmlAttribute(match[2]) : "";
}

function hasNoteAssetImage(markdown) {
  const content = String(markdown || "");
  return (
    content.includes(`${BRAND.noteAssetProtocol}://`) ||
    content.includes(`${BRAND.legacyNoteAssetProtocol}://`)
  );
}

function collectNoteAssetIds(markdown) {
  const protocols = [BRAND.noteAssetProtocol, BRAND.legacyNoteAssetProtocol]
    .map((protocol) => protocol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(`(?:${protocols}):\\/\\/([A-Za-z0-9_-]+)`, "g");
  return new Set(
    Array.from(String(markdown || "").matchAll(pattern)).map((match) => match[1])
  );
}

function appendUnreferencedNoteAssets(markdown) {
  return String(markdown || "");
}

function replaceNoteAssetImageReferences(markdown, replacer) {
  let content = String(markdown || "").replace(
    /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g,
    (match, alt, rawSrc) => {
      const src = String(rawSrc || "")
        .trim()
        .replace(/\s+"[^"]*"$/, "");
      if (!isNoteAssetUrl(src)) return match;
      const nextSrc = replacer(src);
      return nextSrc ? `![${safeMarkdownAlt(alt)}](${nextSrc})` : `![${safeMarkdownAlt(alt)}]()`;
    }
  );

  content = content.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
    const src = readHtmlAttribute(attrs, "src");
    if (!isNoteAssetUrl(src)) return match;
    const nextSrc = replacer(src);
    const alt = readHtmlAttribute(attrs, "alt");
    return nextSrc ? `![${safeMarkdownAlt(alt)}](${nextSrc})` : `![${safeMarkdownAlt(alt)}]()`;
  });

  return content;
}

function normalizeNoteExportField(field) {
  return field === "enhanced_content" ? "enhanced_content" : "content";
}

function selectNoteExportContent(note, field = "content") {
  const exportField = normalizeNoteExportField(field);
  const content = String(note?.content || "");
  const enhancedContent = String(note?.enhanced_content || "");
  return exportField === "enhanced_content" ? enhancedContent : content;
}

function copyNoteAssetsForMarkdown(markdown, databaseManager, outputFilePath, safeBaseName) {
  const outputDir = path.dirname(outputFilePath);
  const assetsDirName = `${safeBaseName}-assets`;
  const assetsDir = path.join(outputDir, assetsDirName);
  let copied = 0;
  const copiedByAssetId = new Map();

  const content = replaceNoteAssetImageReferences(markdown, (src) => {
    const assetId = getAssetIdFromUrl(src);
    if (copiedByAssetId.has(assetId)) return copiedByAssetId.get(assetId);
    const assetData = readNoteAssetBuffer(databaseManager, assetId);
    if (!assetData) return "";
    fs.mkdirSync(assetsDir, { recursive: true });
    const filename = `${assetData.asset.id}-${safeExportName(assetData.asset.filename)}`;
    fs.writeFileSync(path.join(assetsDir, filename), assetData.buffer);
    copied += 1;
    const relativePath = `./${assetsDirName}/${filename}`;
    copiedByAssetId.set(assetId, relativePath);
    return relativePath;
  });

  return { content, assetsDir, copied };
}

function inlineNoteAssetsForHtml(markdown, databaseManager) {
  return replaceNoteAssetImageReferences(markdown, (src) => {
    const assetId = getAssetIdFromUrl(src);
    const assetData = readNoteAssetBuffer(databaseManager, assetId);
    if (!assetData) return "";
    return `data:${assetData.asset.mime_type};base64,${assetData.buffer.toString("base64")}`;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function splitMarkdownTableRow(line) {
  const trimmed = String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  const cells = [];
  let cell = "";
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  if (cells.length === 0) return null;
  const alignments = [];

  for (const cell of cells) {
    const compact = cell.replace(/\s+/g, "");
    if (!/^:?-{3,}:?$/.test(compact)) return null;
    alignments.push(
      compact.startsWith(":") && compact.endsWith(":")
        ? "center"
        : compact.endsWith(":")
          ? "right"
          : compact.startsWith(":")
            ? "left"
            : ""
    );
  }

  return alignments;
}

function isMarkdownTableStart(lines, index) {
  const line = lines[index];
  const separator = lines[index + 1];
  if (!line || !separator || !line.includes("|") || !separator.includes("|")) return false;
  const headerCells = splitMarkdownTableRow(line);
  const alignments = parseMarkdownTableSeparator(separator);
  return !!alignments && headerCells.length === alignments.length;
}

function renderMarkdownTable(lines, startIndex) {
  const headers = splitMarkdownTableRow(lines[startIndex]);
  const alignments = parseMarkdownTableSeparator(lines[startIndex + 1]) || [];
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    rows.push(splitMarkdownTableRow(lines[index]));
    index += 1;
  }

  const alignStyle = (alignment) => (alignment ? ` style="text-align:${alignment}"` : "");
  const html = [
    '<div class="table-wrapper"><table>',
    `<thead><tr>${headers
      .map(
        (cell, cellIndex) => `<th${alignStyle(alignments[cellIndex])}>${inlineMarkdown(cell)}</th>`
      )
      .join("")}</tr></thead>`,
    "<tbody>",
    ...rows.map(
      (row) =>
        `<tr>${headers
          .map(
            (_header, cellIndex) =>
              `<td${alignStyle(alignments[cellIndex])}>${inlineMarkdown(row[cellIndex] || "")}</td>`
          )
          .join("")}</tr>`
    ),
    "</tbody>",
    "</table></div>",
  ];

  return { html: html.join("\n"), nextIndex: index };
}

function markdownToHtml(markdown, title) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = null;

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (isMarkdownTableStart(lines, index)) {
      closeList();
      const table = renderMarkdownTable(lines, index);
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const imageOnly = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageOnly) {
      closeList();
      html.push(`<p class="image-block">${inlineMarkdown(line)}</p>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title || "Untitled")}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; line-height: 1.65; padding: 32px; }
    h1 { font-size: 24px; margin: 0 0 16px; }
    h2 { font-size: 20px; margin: 22px 0 8px; }
    h3 { font-size: 16px; margin: 18px 0 6px; }
    p { margin: 0 0 10px; }
    ul, ol { margin: 0 0 10px 22px; padding: 0; }
    li { margin: 3px 0; }
    code { background: #f3f4f6; border-radius: 3px; padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    img { display: block; max-width: 100%; height: auto; margin: 14px 0; border: 1px solid #e5e7eb; border-radius: 8px; }
    .table-wrapper { overflow-x: auto; margin: 16px 0; border: 1px solid #d1d5db; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-right: 1px solid #d1d5db; border-bottom: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 600; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title || "Untitled")}</h1>
  ${html.join("\n")}
</body>
</html>`;
}

module.exports = {
  appendUnreferencedNoteAssets,
  copyNoteAssetsForMarkdown,
  collectNoteAssetIds,
  hasNoteAssetImage,
  inlineNoteAssetsForHtml,
  markdownToHtml,
  normalizeNoteExportField,
  selectNoteExportContent,
};
