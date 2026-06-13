import OpenCC from "opencc-js";

const traditionalToSimplified = OpenCC.Converter({ from: "hk", to: "cn" });
const simplifiedToTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

export function resolveChineseScript(language) {
  if (typeof language !== "string") return null;
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "auto") return null;
  if (normalized === "zh-cn" || normalized === "zh-hans" || normalized === "zh-sg") {
    return "simplified";
  }
  if (
    normalized === "zh-tw" ||
    normalized === "zh-hant" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo"
  ) {
    return "traditional";
  }
  return null;
}

export function normalizeChineseScript(text, language) {
  if (typeof text !== "string" || !text) return text;
  const script = resolveChineseScript(language);
  if (script === "simplified") return traditionalToSimplified(text);
  if (script === "traditional") return simplifiedToTraditional(text);
  return text;
}
