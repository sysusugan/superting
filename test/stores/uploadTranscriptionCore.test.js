const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createInitialUploadTranscriptionState,
  startUploadTask,
  completeUploadTask,
  failUploadTask,
  resetUploadTask,
  buildUploadNoteSaveArgs,
} = require("../../src/stores/uploadTranscriptionCore");

test("upload transcription task state survives view remounts until reset", () => {
  const initial = createInitialUploadTranscriptionState();
  const file = {
    name: "meeting.mp3",
    path: "/tmp/meeting.mp3",
    size: "3.2 MB",
    sizeBytes: 3355443,
  };

  const running = startUploadTask(initial, file, { folderId: "7" });
  assert.equal(running.state, "transcribing");
  assert.deepEqual(running.file, file);
  assert.equal(running.selectedFolderId, "7");

  const completed = completeUploadTask(running, {
    result: "hello world",
    noteId: 42,
    folderId: "7",
  });

  const remountedViewState = { ...completed };
  assert.equal(remountedViewState.state, "complete");
  assert.equal(remountedViewState.result, "hello world");
  assert.equal(remountedViewState.noteId, 42);
  assert.deepEqual(remountedViewState.file, file);

  const reset = resetUploadTask(remountedViewState, { defaultFolderId: "1" });
  assert.equal(reset.state, "idle");
  assert.equal(reset.file, null);
  assert.equal(reset.selectedFolderId, "1");
});

test("upload transcription failures preserve selected file for retry", () => {
  const file = {
    name: "lecture.wav",
    path: "/tmp/lecture.wav",
    size: "9.1 MB",
    sizeBytes: 9542041,
  };

  const running = startUploadTask(createInitialUploadTranscriptionState(), file);
  const failed = failUploadTask(running, "whisper-server request timed out");

  assert.equal(failed.state, "error");
  assert.equal(failed.error, "whisper-server request timed out");
  assert.deepEqual(failed.file, file);
  assert.equal(failed.progress, 0);
});

test("upload note save args write uploaded transcript to both content and transcript", () => {
  const args = buildUploadNoteSaveArgs({
    title: "Meeting title",
    transcript: "raw uploaded transcript",
    fileName: "meeting.mp3",
    folderId: 3,
  });

  assert.deepEqual(args, {
    title: "Meeting title",
    content: "raw uploaded transcript",
    noteType: "upload",
    sourceFile: "meeting.mp3",
    audioDuration: null,
    folderId: 3,
    transcript: "raw uploaded transcript",
  });
});
