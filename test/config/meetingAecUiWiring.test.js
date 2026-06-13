const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("meeting AEC status is exposed from IPC and stored in renderer state", () => {
  const electronTypes = read("src/types/electron.ts");
  const store = read("src/stores/meetingRecordingStore.ts");

  assert.match(
    electronTypes,
    /export type MeetingAecMode = "enabled" \| "fallback" \| "unavailable"/
  );
  assert.match(electronTypes, /aecMode\?: MeetingAecMode/);
  assert.match(electronTypes, /aecReason\?: MeetingAecReason \| null/);

  assert.match(store, /aecMode: MeetingAecMode \| null/);
  assert.match(store, /aecReason: MeetingAecReason \| null/);
  assert.match(store, /aecMode: startResult\.aecMode \?\? null/);
  assert.match(store, /aecReason: startResult\.aecReason \?\? null/);
});

test("meeting recording UI has localized AEC status copy", () => {
  const view = read("src/components/notes/PersonalNotesView.tsx");
  const en = read("src/locales/en/translation.json");

  assert.match(view, /notes\.recording\.echoCancellation\.enabled/);
  assert.match(view, /notes\.recording\.echoCancellation\.systemAudioMissing/);
  assert.match(view, /notes\.recording\.echoCancellation\.systemAudioFailed/);
  assert.match(view, /notes\.recording\.echoCancellation\.helperUnavailable/);

  const translations = JSON.parse(en);
  assert.equal(
    translations.notes.recording.echoCancellation.enabled,
    "Echo cancellation is active."
  );
  assert.equal(
    translations.notes.recording.echoCancellation.systemAudioMissing,
    "Speaker echo cancellation is unavailable because system audio access is missing. Grant system audio access or use headphones."
  );
});
