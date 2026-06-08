const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("meeting transcription IPC channels exposed by preload are registered in main", () => {
  const preload = read("preload.js");
  const ipcHandlers = read("src/helpers/ipcHandlers.js");

  const exposedChannels = [
    ...preload.matchAll(/ipcRenderer\.(invoke|send)\("meeting-transcription-([^"]+)"/g),
  ].map((match) => ({
    method: match[1] === "invoke" ? "handle" : "on",
    channel: `meeting-transcription-${match[2]}`,
  }));

  assert.notEqual(exposedChannels.length, 0);

  const missing = exposedChannels.filter(
    ({ method, channel }) => !ipcHandlers.includes(`ipcMain.${method}("${channel}"`)
  );

  assert.deepEqual(missing, []);
});
