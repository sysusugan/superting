const IDLE_UPLOAD_TRANSCRIPTION_STATE = Object.freeze({
  state: "idle",
  file: null,
  result: null,
  noteId: null,
  error: null,
  progress: 0,
  chunkProgress: null,
  selectedFolderId: "",
});

function createInitialUploadTranscriptionState(overrides = {}) {
  return {
    ...IDLE_UPLOAD_TRANSCRIPTION_STATE,
    ...overrides,
  };
}

function startUploadTask(current, file, options = {}) {
  return {
    ...current,
    state: "transcribing",
    file,
    result: null,
    noteId: null,
    error: null,
    progress: 0,
    chunkProgress: null,
    selectedFolderId: options.folderId ?? current.selectedFolderId ?? "",
  };
}

function selectUploadFile(current, file) {
  return {
    ...current,
    state: "selected",
    file,
    result: null,
    noteId: null,
    error: null,
    progress: 0,
    chunkProgress: null,
  };
}

function completeUploadTask(current, options) {
  return {
    ...current,
    state: "complete",
    result: options.result,
    noteId: options.noteId,
    error: null,
    progress: 100,
    chunkProgress: null,
    selectedFolderId: options.folderId ?? current.selectedFolderId ?? "",
  };
}

function failUploadTask(current, error) {
  return {
    ...current,
    state: "error",
    error,
    progress: 0,
    chunkProgress: null,
  };
}

function resetUploadTask(_current, options = {}) {
  return createInitialUploadTranscriptionState({
    selectedFolderId: options.defaultFolderId ?? "",
  });
}

function buildUploadNoteSaveArgs({ title, transcript, fileName, folderId }) {
  return {
    title,
    content: transcript,
    noteType: "upload",
    sourceFile: fileName,
    audioDuration: null,
    folderId,
    transcript,
  };
}

module.exports = {
  IDLE_UPLOAD_TRANSCRIPTION_STATE,
  createInitialUploadTranscriptionState,
  selectUploadFile,
  startUploadTask,
  completeUploadTask,
  failUploadTask,
  resetUploadTask,
  buildUploadNoteSaveArgs,
};
