const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("dictation history IPC channels exposed by preload are registered in main", () => {
  const preload = read("preload.js");
  const ipcHandlers = read("src/helpers/ipcHandlers.js");

  const requiredChannels = [
    ...preload.matchAll(
      /ipcRenderer\.invoke\("(retry-transcription|show-audio-in-folder|get-audio-buffer|save-transcription-audio|delete-transcription-audio)"/g
    ),
  ].map((match) => match[1]);

  assert.notEqual(requiredChannels.length, 0);

  const missing = requiredChannels.filter(
    (channel) => !ipcHandlers.includes(`ipcMain.handle("${channel}"`)
  );

  assert.deepEqual(missing, []);
});
