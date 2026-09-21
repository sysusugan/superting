const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness(options = {}) {
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
          if (options.noCache) return null;
          return { id: 1, status: "confirmed", result: { protocolVersion: 2 } };
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
            if (options.model) await options.model();
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
    api: exports,
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

test("batch serially saves current work on stop and does not begin the next note", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({ noCache: true, model: () => gate });
  const pending = h.api.runTrackingBatch(
    [
      { id: 1, title: "A" },
      { id: 2, title: "B" },
    ],
    { id: 8, name: "tracking", output_target: "tracking" },
    { modelId: "test", isCloudMode: false, forceTracking: true },
    { actionFailed: "failed" }
  );
  await new Promise(setImmediate);
  assert.equal(h.calls.model, 1);
  assert.equal(h.api.useActionProcessingStore.getState().batch.entries[1].status, "queued");
  h.api.stopTrackingBatch();
  release();
  await pending;
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.api.useActionProcessingStore.getState().batch.entries[1].status, "cancelled");
  assert.equal(h.api.useActionProcessingStore.getState().batch.running, false);
});

test("batch continues after failure and skips a chat-locked note", async () => {
  let attempt = 0;
  const h = harness({
    noCache: true,
    model: () => {
      if (attempt++ === 0) throw new Error("model failed");
    },
  });
  h.api.beginChatNoteAction(3);
  await h.api.runTrackingBatch(
    [
      { id: 1, title: "A" },
      { id: 2, title: "B" },
      { id: 3, title: "C" },
    ],
    { id: 8, name: "tracking", output_target: "tracking" },
    { modelId: "test", isCloudMode: false, forceTracking: true },
    { actionFailed: "failed" }
  );
  assert.deepEqual(
    Array.from(h.api.useActionProcessingStore.getState().batch.entries, (e) => e.status),
    ["failed", "draft", "busy"]
  );
  assert.equal(h.calls.writes.length, 1);
});

test("completed extraction releases the lock before the success indicator expires", async () => {
  const h = harness();
  await h.run(true);
  assert.equal(h.api.beginChatNoteAction(1), true);
  h.api.endChatNoteAction(1);
  await h.run(true);
  assert.equal(h.calls.model, 2);
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
