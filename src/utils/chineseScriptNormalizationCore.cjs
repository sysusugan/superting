const { Converter } = require("opencc-js");

const toSimplified = Converter({ from: "tw", to: "cn" });
const toTraditional = Converter({ from: "cn", to: "tw" });

function normalizeLanguage(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveChineseScriptTarget(language) {
  const normalized = normalizeLanguage(language);
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

function normalizeChineseScript(text, language) {
  if (typeof text !== "string" || !text) return text;
  const target = resolveChineseScriptTarget(language);
  if (target === "simplified") return toSimplified(text);
  if (target === "traditional") return toTraditional(text);
  return text;
}

module.exports = {
  normalizeChineseScript,
  resolveChineseScriptTarget,
};
