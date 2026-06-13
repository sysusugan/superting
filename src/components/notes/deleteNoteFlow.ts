interface DeleteNoteAndRefreshArgs {
  noteId: number;
  deleteNote: (id: number) => Promise<{ success: boolean }>;
  removeNote: (id: number) => void;
  loadFolders: () => Promise<unknown> | unknown;
}

export async function deleteNoteAndRefresh({
  noteId,
  deleteNote,
  removeNote,
  loadFolders,
}: DeleteNoteAndRefreshArgs): Promise<{ success: boolean }> {
  const result = await deleteNote(noteId);
  if (result.success) {
    removeNote(noteId);
  }
  await loadFolders();
  return result;
}
