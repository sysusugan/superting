const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ipcHandlersPath = path.join(__dirname, "../../src/helpers/ipcHandlers.js");

test("meeting transcription start returns AEC status to renderer", () => {
  const source = fs.readFileSync(ipcHandlersPath, "utf8");

  assert.match(source, /require\("\.\/meetingAecStatus"\)/);
  assert.match(source, /meetingAecStatus = await startMeetingAec\(systemAudioMode\)/);
  assert.match(source, /\.\.\.meetingAecStatus/);
});

test("meeting AEC stops and reports fallback when native system audio startup fails", () => {
  const source = fs.readFileSync(ipcHandlersPath, "utf8");

  assert.match(source, /await stopMeetingAec\(\);/);
  assert.match(source, /meetingAecStatus = resolveMeetingAecSystemAudioFailure\(\);/);
});
