const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness() {
  const calls = { model: 0, cache: 0, writes: [], events: [], noteWrites: 0 };
  const source = fs.readFileSync(
    require.resolve("../../src/stores/actionProcessingStore.ts"),
    "utf8"
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    setTimeout: () => 1,
    clearTimeout() {},
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    window: {
      dispatchEvent: (event) => calls.events.push(event),
      electronAPI: {
        getTrackingExtraction: async () => {
          calls.cache++;
          return { id: 1, status: "confirmed", result: {protocolVersion: 2} };
        },
        saveTrackingExtraction: async (...args) => {
          calls.writes.push(args);
          return { success: true };
        },
        updateNote: async () => {
          calls.noteWrites++;
          return { success: true };
        },
      },
    },
    require: (name) => {
      if (name === "zustand") return require(name);
      if (name === "./runNoteActionOnce")
        return {
          runNoteActionOnce: async () => {
            calls.model++;
            return { generatedContent: '{"updates":[]}', updates: {} };
          },
        };
      if (name === "./noteActionLogger")
        return {
          loggableText: (x) => x,
          logNoteAction() {},
          makeNoteActionOperationId: () => "test",
        };
      if (name === "./actionProcessingCore") return { validateActionUpdateResult() {} };
      throw new Error(name);
    },
  });
  return {
    calls,
    run: (force) =>
      exports.runBackgroundAction(
        1,
        "note",
        "hash",
        {
          id: 8,
          name: "tracking",
          output_target: "tracking",
        },
        { modelId: "test", isCloudMode: false, forceTracking: force },
        { actionFailed: "failed" }
      ),
  };
}

test("normal tracking action reuses cache and refreshes results", async () => {
  const h = harness();
  h.run(false);
  await new Promise(setImmediate);
  assert.equal(h.calls.model, 0);
  assert.equal(h.calls.events.length, 1);
});

test("explicit re-extraction bypasses cache, calls model and saves a new extraction", async () => {
  const h = harness();
  h.run(true);
  await new Promise(setImmediate);
  assert.equal(h.calls.model, 1);
  assert.equal(h.calls.cache, 0);
  assert.equal(h.calls.writes[0][3], true);
  assert.equal(h.calls.events.length, 1);
  assert.equal(h.calls.noteWrites, 0);
});
