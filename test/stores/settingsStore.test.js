const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTypeScript(relativePath, dependencies, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
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
    ...globals,
  });
  return exports;
}

function createSettingsHarness() {
  const storage = new Map();
  let savedCleanupKey = "";
  const saves = [];
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const scopes = loadTypeScript("../../src/config/inferenceScopes.ts", {});
  function restart() {
    const timers = new Map();
    const store = loadTypeScript(
      "../../src/stores/settingsStore.ts",
      {
        zustand: require("zustand"),
        "../config/constants": { API_ENDPOINTS: {} },
        "../i18n": {
          __esModule: true,
          default: { changeLanguage: async () => {} },
          normalizeUiLanguage: (language) => language || "en",
        },
        "../utils/agentName": { ensureAgentNameInDictionary: () => {} },
        "./streamingProvidersStore": {},
        "../utils/logger": { __esModule: true, default: { warn: () => {} } },
        "../constants/whisperVad.json": require("../../src/constants/whisperVad.json"),
        "../config/prompts/registry": { PROMPT_KIND_LIST: [] },
        "../config/inferenceScopes": scopes,
        "../services/ReasoningService": {
          __esModule: true,
          default: { clearApiKeyCache: () => {} },
        },
      },
      {
        localStorage,
        Event,
        window: {
          addEventListener: () => {},
          dispatchEvent: () => {},
          electronAPI: {
            getCleanupCustomKey: async () => savedCleanupKey,
            saveCleanupCustomKey: async (key) => {
              savedCleanupKey = key;
              saves.push(key);
            },
            saveAllKeysToEnv: async () => {},
          },
        },
        setTimeout: (callback) => {
          const id = Symbol();
          timers.set(id, callback);
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      }
    );
    return {
      ...store,
      flushSaves: async () => {
        for (const callback of timers.values()) await callback();
        timers.clear();
      },
    };
  }
  return { restart, localStorage, saves };
}

for (const scope of ["dictationCleanup", "noteFormatting", "dictationAgent", "chatIntelligence"]) {
  test(`${scope} custom key survives saving through the settings editor and restarting`, async () => {
    const harness = createSettingsHarness();
    const first = harness.restart();
    await first.initializeSettings();
    first.setResolvedLLMConfig(scope, {
      provider: "custom",
      cloudBaseUrl: "https://example.invalid/v1",
      customApiKey: "test-only-key",
    });
    await first.flushSaves();

    const restarted = harness.restart();
    await restarted.initializeSettings();
    const config = restarted.selectResolvedLLMConfig(restarted.getSettings(), scope);
    assert.equal(config.customApiKey, "test-only-key");
    assert.equal(config.cloudBaseUrl, "https://example.invalid/v1");
  });
}

test("the dedicated cleanup key setter already saves to the main process and restores on restart", async () => {
  const harness = createSettingsHarness();
  const first = harness.restart();
  await first.initializeSettings();
  first.getSettings().setCleanupCustomApiKey("test-only-key");
  await first.flushSaves();
  assert.deepEqual(harness.saves, ["test-only-key"]);

  const restarted = harness.restart();
  await restarted.initializeSettings();
  assert.equal(restarted.getSettings().cleanupCustomApiKey, "test-only-key");
});

test("the editor saves cleanup keys through IPC without writing plaintext to localStorage", async () => {
  const harness = createSettingsHarness();
  const store = harness.restart();
  await store.initializeSettings();
  store.setResolvedLLMConfig("dictationCleanup", { customApiKey: "test-only-key" });
  assert.equal(harness.localStorage.getItem("cleanupCustomApiKey"), null);
  await store.flushSaves();
  assert.deepEqual(harness.saves, ["test-only-key"]);
});

test("consecutive cleanup key edits persist only the latest value", async () => {
  const harness = createSettingsHarness();
  const first = harness.restart();
  await first.initializeSettings();
  first.setResolvedLLMConfig("dictationCleanup", { customApiKey: "test-old-key" });
  first.setResolvedLLMConfig("dictationCleanup", { customApiKey: "test-new-key" });
  assert.equal(first.getSettings().cleanupCustomApiKey, "test-new-key");
  await first.flushSaves();
  assert.deepEqual(harness.saves, ["test-new-key"]);

  const restarted = harness.restart();
  await restarted.initializeSettings();
  assert.equal(restarted.getSettings().cleanupCustomApiKey, "test-new-key");
});

test("clearing the cleanup key through the editor remains cleared after restart", async () => {
  const harness = createSettingsHarness();
  const first = harness.restart();
  await first.initializeSettings();
  first.setResolvedLLMConfig("dictationCleanup", { customApiKey: "test-only-key" });
  await first.flushSaves();

  const second = harness.restart();
  await second.initializeSettings();
  second.setResolvedLLMConfig("dictationCleanup", { customApiKey: "" });
  await second.flushSaves();
  assert.deepEqual(harness.saves, ["test-only-key", ""]);

  const restarted = harness.restart();
  await restarted.initializeSettings();
  assert.equal(restarted.getSettings().cleanupCustomApiKey, "");
});
