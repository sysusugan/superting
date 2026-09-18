const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

test("note actions correct generated content before building overwrite and append updates", async () => {
  const { applyDictionaryCorrections } = await import("../../src/utils/dictionaryCorrection.js");
  const core = await import("../../src/stores/actionProcessingCore.ts");
  const input = await import("../../src/components/notes/noteActionInput.ts");
  const prompt = await import("../../src/stores/noteActionPrompt.ts");
  const settings = {
    customDictionary: ["arber"],
    customDictionaryAliases: [{ from: "阿波", to: "arber" }],
  };
  let response = "参会人员包括阿波；讨论阿波罗计划。";
  const dependencies = {
    "../services/ReasoningService": { processText: async () => response },
    "./settingsStore": {
      getSettings: () => settings,
      selectResolvedNoteFormatting: () => ({ mode: "providers", provider: "openai" }),
      selectIsCloudNoteFormattingMode: () => false,
    },
    "./noteActionPrompt": prompt,
    "../utils/generateTitle": { generateNoteTitle: async () => "" },
    "../components/notes/noteActionInput": input,
    "./actionProcessingCore": core,
    "./noteActionLogger": {
      loggableText: (value) => value,
      logNoteAction: () => {},
      makeNoteActionOperationId: () => "test-action",
    },
    "../utils/dictionaryCorrection": { applyDictionaryCorrections },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/stores/runNoteActionOnce.ts"),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const args = {
    note: {
      title: "Existing title",
      content: "原笔记",
      enhanced_content: "旧纪要",
      transcript: "阿波",
      created_at: "2026-09-01",
    },
    action: { id: 1, name: "会议纪要", prompt: "整理会议纪要" },
    modelId: "test-model",
    isCloudMode: false,
    speakerLabels: { you: "You", them: "Them" },
  };
  for (const target of ["content", "enhanced_content"]) {
    for (const mode of ["overwrite", "append"]) {
      const result = await exports.runNoteActionOnce({
        ...args,
        action: { ...args.action, output_target: target, write_mode: mode },
      });
      assert.equal(result.generatedContent, "参会人员包括arber；讨论阿波罗计划。");
      const prefix = mode === "append" ? `${args.note[target]}\n\n` : "";
      assert.equal(result.updates[target], `${prefix}参会人员包括arber；讨论阿波罗计划。`);
    }
  }
  response = " ";
  await assert.rejects(exports.runNoteActionOnce(args), /Action generated empty content/);
});
