import { create } from "zustand";
import type { NoteItem, NoteSortBy } from "../types/electron";

interface NoteState {
  notes: NoteItem[];
  activeNoteId: number | null;
  activeFolderId: number | null;
}

const useNoteStore = create<NoteState>()(() => ({
  notes: [],
  activeNoteId: null,
  activeFolderId: null,
}));

let hasBoundIpcListeners = false;
const DEFAULT_LIMIT = 50;
let currentLimit = DEFAULT_LIMIT;
let loadGeneration = 0;

function getTimestampMs(value: string | null | undefined): number {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function preferNewerNote(incoming: NoteItem, existing: NoteItem | undefined): NoteItem {
  if (!existing) return incoming;
  return getTimestampMs(existing.updated_at) > getTimestampMs(incoming.updated_at)
    ? existing
    : incoming;
}

function ensureIpcListeners() {
  if (hasBoundIpcListeners || typeof window === "undefined") {
    return;
  }

  const disposers: Array<() => void> = [];

  if (window.electronAPI?.onNoteAdded) {
    const dispose = window.electronAPI.onNoteAdded((note) => {
      if (note) {
        addNote(note);
      }
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  if (window.electronAPI?.onNoteUpdated) {
    const dispose = window.electronAPI.onNoteUpdated((note) => {
      if (note) {
        updateNoteInStore(note);
      }
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  if (window.electronAPI?.onNoteDeleted) {
    const dispose = window.electronAPI.onNoteDeleted(({ id }) => {
      removeNote(id);
    });
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  }

  hasBoundIpcListeners = true;

  window.addEventListener("beforeunload", () => {
    disposers.forEach((dispose) => dispose());
  });
}

export async function initializeNotes(
  noteType?: string | null,
  limit = DEFAULT_LIMIT,
  folderId?: number | null,
  sortBy: NoteSortBy = "updatedAt"
): Promise<NoteItem[]> {
  const gen = ++loadGeneration;
  currentLimit = limit;
  ensureIpcListeners();
  const items = (await window.electronAPI?.getNotes(noteType, limit, folderId, sortBy)) ?? [];
  if (gen !== loadGeneration) return items;
  const existingById = new Map(useNoteStore.getState().notes.map((note) => [note.id, note]));
  useNoteStore.setState({
    notes: items.map((note) => preferNewerNote(note, existingById.get(note.id))),
  });
  return items;
}

export function addNote(note: NoteItem): void {
  if (!note) return;
  const { notes, activeFolderId } = useNoteStore.getState();
  if (activeFolderId && note.folder_id !== activeFolderId) return;
  const withoutDuplicate = notes.filter((existing) => existing.id !== note.id);
  useNoteStore.setState({ notes: [note, ...withoutDuplicate].slice(0, currentLimit) });
}

export function updateNoteInStore(note: NoteItem): void {
  if (!note) return;
  if (note.deleted_at) {
    removeNote(note.id);
    return;
  }
  const { notes, activeFolderId } = useNoteStore.getState();
  if (activeFolderId && note.folder_id !== activeFolderId) return;
  const hasExisting = notes.some((existing) => existing.id === note.id);
  useNoteStore.setState({
    notes: hasExisting
      ? notes.map((existing) =>
          existing.id === note.id ? preferNewerNote(note, existing) : existing
        )
      : [note, ...notes].slice(0, currentLimit),
  });
}

export function removeNote(id: number): void {
  if (id == null) return;
  const { notes, activeNoteId } = useNoteStore.getState();
  const next = notes.filter((item) => item.id !== id);
  if (next.length === notes.length) return;
  const update: Partial<NoteState> = { notes: next };
  if (activeNoteId === id) {
    const idx = notes.findIndex((item) => item.id === id);
    const neighbor = next[Math.min(idx, next.length - 1)] ?? null;
    update.activeNoteId = neighbor?.id ?? null;
  }
  useNoteStore.setState(update);
}

export function setActiveNoteId(id: number | null): void {
  if (useNoteStore.getState().activeNoteId === id) return;
  useNoteStore.setState({ activeNoteId: id });
}

export function setActiveFolderId(id: number | null): void {
  if (useNoteStore.getState().activeFolderId === id) return;
  useNoteStore.setState({ activeFolderId: id });
}

export function getActiveNoteIdValue(): number | null {
  return useNoteStore.getState().activeNoteId;
}

export function getActiveFolderIdValue(): number | null {
  return useNoteStore.getState().activeFolderId;
}

export function getNotesValue(): NoteItem[] {
  return useNoteStore.getState().notes;
}

export function useNotes(): NoteItem[] {
  return useNoteStore((state) => state.notes);
}

export function useActiveNoteId(): number | null {
  return useNoteStore((state) => state.activeNoteId);
}

export function useActiveFolderId(): number | null {
  return useNoteStore((state) => state.activeFolderId);
}
