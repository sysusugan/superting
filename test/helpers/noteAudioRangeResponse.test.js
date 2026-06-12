const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createNoteAudioFileResponse } = require("../../src/helpers/noteAudioRangeResponse");

function createAudioFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-range-"));
  const filePath = path.join(root, "sample.wav");
  fs.writeFileSync(filePath, "0123456789");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return filePath;
}

async function readResponseText(response) {
  return Buffer.from(await response.arrayBuffer()).toString("utf8");
}

test("note audio response serves full files without range", async (t) => {
  const filePath = createAudioFixture(t);

  const response = createNoteAudioFileResponse(filePath, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(await readResponseText(response), "0123456789");
});

test("note audio response serves byte ranges", async (t) => {
  const filePath = createAudioFixture(t);

  const response = createNoteAudioFileResponse(filePath, { range: "bytes=2-5" });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(await readResponseText(response), "2345");
});

test("note audio response rejects invalid byte ranges", (t) => {
  const filePath = createAudioFixture(t);

  const response = createNoteAudioFileResponse(filePath, { range: "bytes=99-100" });

  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */10");
});
