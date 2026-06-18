const TRANSCRIPT_IMPORT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".docx"]);

export const TRANSCRIPT_IMPORT_ACCEPT =
  ".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type DocxTextExtractor = (buffer: ArrayBuffer) => Promise<string>;

function getFileExtension(name: string): string {
  const index = String(name || "").lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function isSupportedTranscriptImportFileName(name: string): boolean {
  return TRANSCRIPT_IMPORT_EXTENSIONS.has(getFileExtension(name));
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser.js");
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

export async function readImportedTranscriptFileText(
  file: File,
  docxTextExtractor: DocxTextExtractor = extractDocxText
): Promise<string> {
  const ext = getFileExtension(file.name);
  if (!TRANSCRIPT_IMPORT_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported transcript import file type");
  }

  if (ext === ".docx") {
    return docxTextExtractor(await file.arrayBuffer());
  }

  return file.text();
}
