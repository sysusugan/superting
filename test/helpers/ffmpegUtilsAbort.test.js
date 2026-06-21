const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getAppPath: () => "/tmp/superting-test",
        getPath: () => "/tmp/superting-test",
        isReady: () => false,
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { convertToWav, splitAudioFile } = require("../../src/helpers/ffmpegUtils");

test("convertToWav rejects immediately when signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));

  await assert.rejects(
    convertToWav("/missing/input.webm", "/missing/output.wav", { signal: controller.signal }),
    (error) => {
      assert.equal(error.code, "CANCELLED");
      return true;
    }
  );
});

test("splitAudioFile rejects immediately when signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));

  await assert.rejects(
    splitAudioFile("/missing/input.webm", "/missing/output-dir", { signal: controller.signal }),
    (error) => {
      assert.equal(error.code, "CANCELLED");
      return true;
    }
  );
});
