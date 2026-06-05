const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DatabaseManager = require("../../src/helpers/database");

function createDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-db-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = new DatabaseManager({ dbPath: path.join(root, "transcriptions.db") });
  t.after(() => db.cleanup());
  return db;
}

test("note audio files retain multiple saved recordings for one note", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Meeting", "", "meeting").note;

  db.addNoteAudioFile(note.id, "OpenWhispr-meeting-2026-05-29-10-00-00-1.wav", 60, {
    recordedAt: "2026-05-29T10:00:00.000Z",
  });
  db.addNoteAudioFile(note.id, "OpenWhispr-meeting-2026-05-29-10-30-00-1.wav", 30, {
    recordedAt: "2026-05-29T10:30:00.000Z",
  });

  const files = db.getNoteAudioFiles(note.id);

  assert.deepEqual(
    files.map((file) => file.filename),
    ["OpenWhispr-meeting-2026-05-29-10-30-00-1.wav", "OpenWhispr-meeting-2026-05-29-10-00-00-1.wav"]
  );
  assert.equal(files[0].duration_seconds, 30);
});

test("existing note source files are backfilled once into note audio files", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote(
    "Legacy",
    "",
    "meeting",
    "OpenWhispr-meeting-2026-05-29-10-00-00-2.wav",
    42
  ).note;

  db.backfillNoteAudioFiles();
  db.backfillNoteAudioFiles();

  const files = db.getNoteAudioFiles(note.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, "OpenWhispr-meeting-2026-05-29-10-00-00-2.wav");
  assert.equal(files[0].duration_seconds, 42);
});

test("backfill ignores upload source files that are not retained local audio", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Upload", "", "upload", "customer-call.mp3", null).note;

  db.backfillNoteAudioFiles();

  assert.deepEqual(db.getNoteAudioFiles(note.id), []);
});

test("removing note audio files falls back note source_file to latest remaining recording", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Meeting", "", "meeting").note;
  const older = "OpenWhispr-meeting-2026-05-29-10-00-00-3.wav";
  const newer = "OpenWhispr-meeting-2026-05-29-10-30-00-3.wav";

  db.addNoteAudioFile(note.id, older, 60, {
    recordedAt: "2026-05-29T10:00:00.000Z",
    updateLatest: true,
  });
  db.addNoteAudioFile(note.id, newer, 30, {
    recordedAt: "2026-05-29T10:30:00.000Z",
    updateLatest: true,
  });

  db.removeNoteAudioFilesByFilename([newer], [older]);

  const updated = db.getNote(note.id);
  assert.equal(updated.source_file, older);
  assert.equal(updated.audio_duration_seconds, 60);
  assert.deepEqual(
    db.getNoteAudioFiles(note.id).map((file) => file.filename),
    [older]
  );
});

test("replaceNoteAudioFilesWithMergedFile keeps only merged recording as latest source", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Meeting", "", "meeting").note;
  const older = "OpenWhispr-meeting-2026-05-29-10-00-00-3.wav";
  const newer = "OpenWhispr-meeting-2026-05-29-10-30-00-3.wav";
  const merged = "OpenWhispr-meeting-merged-2026-05-29-10-45-00-3.webm";

  db.addNoteAudioFile(note.id, older, 60, {
    recordedAt: "2026-05-29T10:00:00.000Z",
    updateLatest: true,
  });
  db.addNoteAudioFile(note.id, newer, 30, {
    recordedAt: "2026-05-29T10:30:00.000Z",
    updateLatest: true,
  });

  const result = db.replaceNoteAudioFilesWithMergedFile(
    note.id,
    [older, newer],
    merged,
    90,
    { recordedAt: "2026-05-29T10:45:00.000Z" }
  );

  assert.equal(result.success, true);
  const updated = db.getNote(note.id);
  assert.equal(updated.source_file, merged);
  assert.equal(updated.audio_duration_seconds, 90);
  assert.deepEqual(
    db.getNoteAudioFiles(note.id).map((file) => file.filename),
    [merged]
  );
});

test("replaceNoteAudioFilename preserves a note recording when compressed globally", (t) => {
  const db = createDatabase(t);
  const note = db.saveNote("Meeting", "", "meeting").note;
  const wavName = "OpenWhispr-meeting-2026-05-29-10-00-00-4.wav";
  const webmName = "OpenWhispr-meeting-2026-05-29-10-00-00-4.webm";

  db.addNoteAudioFile(note.id, wavName, 60, {
    recordedAt: "2026-05-29T10:00:00.000Z",
    updateLatest: true,
  });

  const result = db.replaceNoteAudioFilename(wavName, webmName);

  assert.equal(result.success, true);
  assert.equal(result.affectedNotes, 1);
  assert.deepEqual(result.affectedNoteIds, [note.id]);
  const updated = db.getNote(note.id);
  assert.equal(updated.source_file, webmName);
  assert.equal(updated.audio_duration_seconds, 60);
  const files = db.getNoteAudioFiles(note.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, webmName);
  assert.equal(files[0].duration_seconds, 60);
});

test("backfill from audio directory imports old meeting audio files with note ids", (t) => {
  const db = createDatabase(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const note = db.saveNote("Meeting", "", "meeting").note;
  const older = `OpenWhispr-meeting-2026-05-29-10-00-00-${note.id}.wav`;
  const newer = `OpenWhispr-meeting-2026-05-29-10-30-00-${note.id}.wav`;
  fs.writeFileSync(path.join(root, older), Buffer.alloc(44));
  fs.writeFileSync(path.join(root, newer), Buffer.alloc(44));
  fs.writeFileSync(path.join(root, "OpenWhispr-meeting-2026-05-29-10-45-00-999999.wav"), "");
  fs.writeFileSync(path.join(root, "OpenWhispr-2026-05-29-10-45-00-1.webm"), "");
  fs.writeFileSync(path.join(root, "customer-call.wav"), "");

  db.backfillNoteAudioFilesFromDirectory(root);
  db.backfillNoteAudioFilesFromDirectory(root);

  const files = db.getNoteAudioFiles(note.id);
  assert.deepEqual(
    files.map((file) => file.filename),
    [newer, older]
  );

  const updated = db.getNote(note.id);
  assert.equal(updated.source_file, newer);
});
