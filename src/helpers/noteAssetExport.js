const fs = require("fs");
const path = require("path");
const { getAssetIdFromUrl, isNoteAssetUrl, readNoteAssetBuffer } = require("./noteAssetStorage");

function safeExportName(value) {
  return String(value || "image")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .slice(0, 80);
}

function replaceMarkdownImageUrls(markdown, replacer) {
  return String(markdown || "").replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    if (!isNoteAssetUrl(src)) return match;
    const nextSrc = replacer(src);
    return nextSrc ? `![${alt}](${nextSrc})` : `![${alt}]()`;
  });
}

function copyNoteAssetsForMarkdown(markdown, databaseManager, outputFilePath, safeBaseName) {
  const outputDir = path.dirname(outputFilePath);
  const assetsDirName = `${safeBaseName}-assets`;
  const assetsDir = path.join(outputDir, assetsDirName);
  let copied = 0;

  const content = replaceMarkdownImageUrls(markdown, (src) => {
    const assetId = getAssetIdFromUrl(src);
    const assetData = readNoteAssetBuffer(databaseManager, assetId);
    if (!assetData) return "";
    fs.mkdirSync(assetsDir, { recursive: true });
    const filename = `${assetData.asset.id}-${safeExportName(assetData.asset.filename)}`;
    fs.writeFileSync(path.join(assetsDir, filename), assetData.buffer);
    copied += 1;
    return `./${assetsDirName}/${filename}`;
  });

  return { content, assetsDir, copied };
}

function inlineNoteAssetsForHtml(markdown, databaseManager) {
  return replaceMarkdownImageUrls(markdown, (src) => {
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

function markdownToHtml(markdown, title) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = null;

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      closeList();
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
  </style>
</head>
<body>
  <h1>${escapeHtml(title || "Untitled")}</h1>
  ${html.join("\n")}
</body>
</html>`;
}

module.exports = {
  copyNoteAssetsForMarkdown,
  inlineNoteAssetsForHtml,
  markdownToHtml,
};
