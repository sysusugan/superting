const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("note tag IPC is exposed by preload and registered in main", () => {
  const preload = read("preload.js");
  const handlers = read("src/helpers/ipcHandlers.js");

  assert.match(preload, /getTags:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("db-get-tags"\)/);
  assert.match(handlers, /ipcMain\.handle\("db-get-tags"/);
  assert.match(handlers, /mcp-get-server-status[\s\S]*?tools:\s*\[\]/);
  assert.match(preload, /saveNote:\s*\([^)]*tags[^)]*\)/);
  assert.match(preload, /getNotes:\s*\([^)]*tags[^)]*\)/);
  assert.match(preload, /searchNotes:\s*\([^)]*tags[^)]*\)/);
});
