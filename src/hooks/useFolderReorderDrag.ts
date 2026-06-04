import { useCallback, useState } from "react";
import type { FolderItem } from "../types/electron";

const FOLDER_DRAG_TYPE = "application/x-folder-id";

type DropPosition = "before" | "after";

interface FolderReorderState {
  draggingFolderId: number | null;
  dragOverFolderId: number | null;
  dropPosition: DropPosition | null;
}

interface UseFolderReorderDragOptions {
  folders: FolderItem[];
  onReorderFolders: (folderIds: number[]) => Promise<void>;
}

function hasFolderDragData(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(FOLDER_DRAG_TYPE);
}

function getDropPosition(e: React.DragEvent): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function reorderFolderIds(
  folders: FolderItem[],
  draggingFolderId: number,
  targetFolderId: number,
  position: DropPosition
): number[] {
  const ids = folders.map((folder) => folder.id);
  const withoutDragged = ids.filter((id) => id !== draggingFolderId);
  const targetIndex = withoutDragged.indexOf(targetFolderId);
  if (targetIndex === -1) return ids;
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  withoutDragged.splice(insertIndex, 0, draggingFolderId);
  return withoutDragged;
}

export function useFolderReorderDrag({ folders, onReorderFolders }: UseFolderReorderDragOptions) {
  const [folderReorderState, setFolderReorderState] = useState<FolderReorderState>({
    draggingFolderId: null,
    dragOverFolderId: null,
    dropPosition: null,
  });

  const folderDragHandleProps = useCallback(
    (folder: FolderItem) => ({
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(FOLDER_DRAG_TYPE, String(folder.id));

        const ghost = document.createElement("div");
        ghost.textContent = folder.name;
        ghost.style.cssText = `
          position: fixed; top: -200px; left: -200px;
          padding: 4px 10px;
          background: color-mix(in oklch, var(--color-popover) 95%, transparent);
          color: var(--color-popover-foreground);
          font-size: 11px;
          font-weight: 500;
          border-radius: 6px;
          border: 1px solid var(--color-border);
          white-space: nowrap;
          pointer-events: none;
        `;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => ghost.remove());

        setFolderReorderState({
          draggingFolderId: folder.id,
          dragOverFolderId: null,
          dropPosition: null,
        });
      },
      onDragEnd: () => {
        setFolderReorderState({
          draggingFolderId: null,
          dragOverFolderId: null,
          dropPosition: null,
        });
      },
    }),
    []
  );

  const folderReorderDropHandlers = useCallback(
    (targetFolderId: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!hasFolderDragData(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const position = getDropPosition(e);
        setFolderReorderState((prev) => ({
          ...prev,
          dragOverFolderId: targetFolderId,
          dropPosition: position,
        }));
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!hasFolderDragData(e)) return;
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setFolderReorderState((prev) =>
          prev.dragOverFolderId === targetFolderId
            ? { ...prev, dragOverFolderId: null, dropPosition: null }
            : prev
        );
      },
      onDrop: async (e: React.DragEvent) => {
        if (!hasFolderDragData(e)) return;
        e.preventDefault();
        const draggingFolderId = Number(e.dataTransfer.getData(FOLDER_DRAG_TYPE));
        const position = getDropPosition(e);
        setFolderReorderState({
          draggingFolderId: null,
          dragOverFolderId: null,
          dropPosition: null,
        });
        if (!Number.isInteger(draggingFolderId) || draggingFolderId === targetFolderId) return;
        await onReorderFolders(
          reorderFolderIds(folders, draggingFolderId, targetFolderId, position)
        );
      },
    }),
    [folders, onReorderFolders]
  );

  return { folderReorderState, folderDragHandleProps, folderReorderDropHandlers };
}
