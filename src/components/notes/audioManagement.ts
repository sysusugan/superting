export type AudioFileLike = {
  extension?: string | null;
};

export type AudioBulkSelection = {
  merge: boolean;
  compress: boolean;
};

export function getAudioBulkAvailability(files: AudioFileLike[]) {
  return {
    canMerge: files.length > 1,
    canCompress: files.some((file) => file.extension?.toLowerCase() !== "webm"),
  };
}

export function getAudioBulkAction(selection: AudioBulkSelection) {
  if (selection.merge) {
    return {
      labelKey: selection.compress
        ? "notes.editor.mergeAndCompressAudio"
        : "notes.editor.mergeAudio",
      runningLabelKey: "notes.editor.mergingAudio",
      requiresMergeConfirmation: true,
      operation: "merge" as const,
    };
  }
  if (selection.compress) {
    return {
      labelKey: "notes.editor.compressAudio",
      runningLabelKey: "notes.editor.compressingAudio",
      requiresMergeConfirmation: false,
      operation: "compress" as const,
    };
  }
  return {
    labelKey: "notes.editor.executeAudioAction",
    runningLabelKey: "notes.editor.executingAudioAction",
    requiresMergeConfirmation: false,
    operation: "none" as const,
  };
}
